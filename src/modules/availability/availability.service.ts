import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatInTimeZone,
  zonedTimeToUtc,
  utcToZonedTime,
} from 'date-fns-tz';

interface TimeBlock {
  start: Date;
  end: Date;
}

export interface AvailableSlot {
  startTime: string;
  endTime: string;
  displayLabel: string;
}

interface OperatingPeriod {
  open: string;
  close: string;
}

interface OperatingHours {
  [dayName: string]: OperatingPeriod[] | { open: string; close: string } | null;
}

@Injectable()
export class AvailabilityService {
  private readonly EXPLORATION_STEP_MINUTES = 15;

  constructor(private prisma: PrismaService) {}

  private normalizeDayPeriods(value: any): OperatingPeriod[] {
    if (!value) return [];

    const periods = Array.isArray(value)
      ? value
      : value?.open && value?.close
        ? [value]
        : [];

    return periods
      .filter(
        (period) =>
          period &&
          typeof period.open === 'string' &&
          typeof period.close === 'string' &&
          /^([0-1]\d|2[0-3]):([0-5]\d)$/.test(period.open) &&
          /^([0-1]\d|2[0-3]):([0-5]\d)$/.test(period.close) &&
          period.open < period.close,
      )
      .map((period) => ({
        open: period.open,
        close: period.close,
      }))
      .sort((a, b) => a.open.localeCompare(b.open));
  }

  async getAvailableSlots(
    businessId: string,
    targetDate: Date,
    vehicleType: string,
    serviceModeId: string,
  ): Promise<AvailableSlot[]> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: { settings: true },
    });

    if (!business?.settings) {
      throw new NotFoundException('Configurações de negócio não encontradas');
    }

    const timezone = business.timezone || 'America/Sao_Paulo';
    const targetDateInTz = utcToZonedTime(targetDate, timezone);

    const nowInTz = utcToZonedTime(new Date(), timezone);
    if (this.isDateInPast(targetDateInTz, nowInTz)) {
      throw new BadRequestException('Data selecionada é do passado');
    }

    const serviceRule = await this.prisma.serviceModeRule.findFirst({
      where: {
        serviceMode: { id: serviceModeId, businessId },
        vehicleType: { kind: vehicleType },
      },
    });

    if (!serviceRule) {
      throw new BadRequestException(
        'Modalidade não disponível para este tipo de veículo',
      );
    }

    const durationMinutes = serviceRule.durationMinutes;

    const operatingHours = business.settings.operatingHours as OperatingHours;
    const dayName = this.getDayName(targetDateInTz);
    const dayPeriods = this.normalizeDayPeriods(operatingHours?.[dayName]);

    if (dayPeriods.length === 0) {
      return [];
    }

    const businessPeriods = dayPeriods.map((period) => ({
      start: this.combineDateTime(targetDateInTz, period.open, timezone),
      end: this.combineDateTime(targetDateInTz, period.close, timezone),
    }));

    const minimumAdvanceMinutes =
      business.settings.minimumAdvanceMinutes || 15;
    const earliestSlotTime = new Date(
      nowInTz.getTime() + minimumAdvanceMinutes * 60000,
    );

    if (businessPeriods.every((period) => earliestSlotTime > period.end)) {
      return [];
    }

    const scheduleBlocks = await this.getScheduleBlocksForDate(
      businessId,
      targetDateInTz,
      timezone,
    );

    const blockTimeBlocks: TimeBlock[] = scheduleBlocks
      .filter((block) => block.isActive && !block.deletedAt)
      .map((block) => ({
        start: block.startAt,
        end: block.endAt,
      }));

    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        scheduledStartAt: {
          gte: this.startOfDay(targetDateInTz, timezone),
          lt: this.endOfDay(targetDateInTz, timezone),
        },
        deletedAt: null,
      },
    });

    const appointmentTimeBlocks: TimeBlock[] = appointments.map((apt) => ({
      start: apt.scheduledStartAt,
      end: apt.scheduledEndAt,
    }));

    const allOccupiedBlocks = [...blockTimeBlocks, ...appointmentTimeBlocks];
    const mergedOccupiedBlocks = this.mergeTimeBlocks(allOccupiedBlocks);

    const allFreeIntervals: TimeBlock[] = [];

    for (const period of businessPeriods) {
      const freeIntervals = this.calculateFreeIntervals(
        period.start,
        period.end,
        mergedOccupiedBlocks,
      );

      allFreeIntervals.push(...freeIntervals);
    }

    const startMarkers = this.extractStartMarkers(
      allFreeIntervals,
      durationMinutes,
    );

    const validSlots: AvailableSlot[] = [];

    for (const marker of startMarkers) {
      if (marker < earliestSlotTime) {
        continue;
      }

      const slotStart = new Date(marker);
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

      const fitsInSomePeriod = businessPeriods.some(
        (period) => slotStart >= period.start && slotEnd <= period.end,
      );

      if (!fitsInSomePeriod) {
        continue;
      }

      if (!this.isTimeBlockFree(slotStart, slotEnd, mergedOccupiedBlocks)) {
        continue;
      }

      validSlots.push({
        startTime: this.formatTime(slotStart, timezone),
        endTime: this.formatTime(slotEnd, timezone),
        displayLabel: `${this.formatTime(slotStart, timezone)} - ${this.formatTime(slotEnd, timezone)}`,
      });
    }

    return validSlots;
  }

  async validateSlotAvailability(
    businessId: string,
    targetDate: Date,
    startTime: string,
    vehicleType: string,
    serviceModeId: string,
  ): Promise<boolean> {
    try {
      if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(startTime)) {
        return false;
      }

      const serviceRule = await this.prisma.serviceModeRule.findFirst({
        where: {
          serviceMode: { id: serviceModeId, businessId },
          vehicleType: { kind: vehicleType },
        },
      });

      if (!serviceRule) return false;

      const business = await this.prisma.business.findUnique({
        where: { id: businessId },
        include: { settings: true },
      });

      if (!business?.settings) return false;

      const timezone = business.timezone || 'America/Sao_Paulo';
      const targetDateInTz = utcToZonedTime(targetDate, timezone);

      const slotStart = this.combineDateTime(
        targetDateInTz,
        startTime,
        timezone,
      );
      const slotEnd = new Date(
        slotStart.getTime() + serviceRule.durationMinutes * 60000,
      );

      const operatingHours = business.settings.operatingHours as OperatingHours;
      const dayName = this.getDayName(targetDateInTz);
      const dayPeriods = this.normalizeDayPeriods(operatingHours?.[dayName]);

      if (dayPeriods.length === 0) return false;

      const businessPeriods = dayPeriods.map((period) => ({
        start: this.combineDateTime(targetDateInTz, period.open, timezone),
        end: this.combineDateTime(targetDateInTz, period.close, timezone),
      }));

      const fitsInSomePeriod = businessPeriods.some(
        (period) => slotStart >= period.start && slotEnd <= period.end,
      );

      if (!fitsInSomePeriod) {
        return false;
      }

      const scheduleBlocks = await this.getScheduleBlocksForDate(
        businessId,
        targetDateInTz,
        timezone,
      );

      const blockTimeBlocks = scheduleBlocks
        .filter((block) => block.isActive && !block.deletedAt)
        .map((block) => ({
          start: block.startAt,
          end: block.endAt,
        }));

      const appointments = await this.prisma.appointment.findMany({
        where: {
          businessId,
          status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
          scheduledStartAt: {
            gte: this.startOfDay(targetDateInTz, timezone),
            lt: this.endOfDay(targetDateInTz, timezone),
          },
          deletedAt: null,
        },
      });

      const appointmentTimeBlocks: TimeBlock[] = appointments.map((apt) => ({
        start: apt.scheduledStartAt,
        end: apt.scheduledEndAt,
      }));

      const allOccupiedBlocks = [...blockTimeBlocks, ...appointmentTimeBlocks];
      const mergedOccupiedBlocks = this.mergeTimeBlocks(allOccupiedBlocks);

      return this.isTimeBlockFree(slotStart, slotEnd, mergedOccupiedBlocks);
    } catch {
      return false;
    }
  }

  private async getScheduleBlocksForDate(
    businessId: string,
    targetDate: Date,
    timezone: string,
  ) {
    const dayOfWeek = this.getDayName(targetDate);
    const startOfDayUTC = this.startOfDay(targetDate, timezone);
    const endOfDayUTC = this.endOfDay(targetDate, timezone);

    const scheduleBlocks = await this.prisma.scheduleBlock.findMany({
      where: {
        businessId,
        isActive: true,
        deletedAt: null,
        OR: [
          {
            startAt: { lt: endOfDayUTC },
            endAt: { gt: startOfDayUTC },
          },
          {
            isRecurring: true,
          },
        ],
      },
    });

    return scheduleBlocks.filter((block) => {
      if (!block.isRecurring) {
        return true;
      }

      if (block.recurringEndDate && block.recurringEndDate < targetDate) {
        return false;
      }

      const recurringDays = Array.isArray(block.recurringDays)
        ? block.recurringDays
        : [];

      return recurringDays.includes(dayOfWeek);
    });
  }

  private combineDateTime(
    date: Date,
    timeStr: string,
    timezone: string,
  ): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);

    const dateStr = formatInTimeZone(date, timezone, 'yyyy-MM-dd');
    const datetimeStr = `${dateStr} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

    return zonedTimeToUtc(datetimeStr, timezone);
  }

  private formatTime(date: Date, timezone: string): string {
    return formatInTimeZone(date, timezone, 'HH:mm');
  }

  private startOfDay(date: Date, timezone: string): Date {
    const local = utcToZonedTime(date, timezone);
    const result = new Date(local);
    result.setHours(0, 0, 0, 0);
    return zonedTimeToUtc(result, timezone);
  }

  private endOfDay(date: Date, timezone: string): Date {
    const local = utcToZonedTime(date, timezone);
    const result = new Date(local);
    result.setHours(23, 59, 59, 999);
    return zonedTimeToUtc(result, timezone);
  }

  private isDateInPast(targetDate: Date, now: Date): boolean {
    const targetStartOfDay = new Date(targetDate);
    targetStartOfDay.setHours(0, 0, 0, 0);
    const nowStartOfDay = new Date(now);
    nowStartOfDay.setHours(0, 0, 0, 0);
    return targetStartOfDay < nowStartOfDay;
  }

  private getDayName(date: Date): string {
    const days = [
      'SUNDAY',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ];
    return days[date.getDay()];
  }

  private mergeTimeBlocks(blocks: TimeBlock[]): TimeBlock[] {
    if (blocks.length === 0) return [];

    const sorted = [...blocks].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );

    const merged: TimeBlock[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const current = sorted[i];

      if (current.start <= last.end) {
        last.end = new Date(
          Math.max(last.end.getTime(), current.end.getTime()),
        );
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  private calculateFreeIntervals(
    start: Date,
    end: Date,
    occupiedBlocks: TimeBlock[],
  ): TimeBlock[] {
    if (occupiedBlocks.length === 0) {
      return [{ start, end }];
    }

    const freeIntervals: TimeBlock[] = [];
    let currentFreeStart = start;

    for (const block of occupiedBlocks) {
      if (block.end <= start || block.start >= end) {
        continue;
      }

      if (currentFreeStart < block.start) {
        freeIntervals.push({
          start: currentFreeStart,
          end: block.start,
        });
      }

      currentFreeStart = new Date(
        Math.max(currentFreeStart.getTime(), block.end.getTime()),
      );
    }

    if (currentFreeStart < end) {
      freeIntervals.push({
        start: currentFreeStart,
        end,
      });
    }

    return freeIntervals;
  }

  private extractStartMarkers(
    freeIntervals: TimeBlock[],
    durationMinutes: number,
  ): Date[] {
    const markers: Date[] = [];

    for (const interval of freeIntervals) {
      let current = new Date(interval.start);

      while (
        current.getTime() + durationMinutes * 60000 <= interval.end.getTime()
      ) {
        markers.push(new Date(current));

        current = new Date(
          current.getTime() + this.EXPLORATION_STEP_MINUTES * 60000,
        );
      }
    }

    const unique = Array.from(new Set(markers.map((m) => m.getTime()))).map(
      (t) => new Date(t),
    );

    return unique.sort((a, b) => a.getTime() - b.getTime());
  }

  private isTimeBlockFree(
    slotStart: Date,
    slotEnd: Date,
    occupiedBlocks: TimeBlock[],
  ): boolean {
    return !occupiedBlocks.some(
      (block) => !(slotEnd <= block.start || slotStart >= block.end),
    );
  }
}