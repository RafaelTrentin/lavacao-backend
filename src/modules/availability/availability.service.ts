import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addCivilDays, businessTimezone, civilDate, dayBounds, localInstants, localParts, weekday } from '../../common/business-time';

interface TimeBlock { start: Date; end: Date }
interface OperatingPeriod { open: string; close: string }
interface OperatingHours { [dayName: string]: OperatingPeriod[] | OperatingPeriod | null }
export interface AvailableSlot {
  startTime: string; endTime: string; displayLabel: string;
  scheduledStartAt: string; scheduledEndAt: string; timezone: string;
}
interface ValidationOptions {
  tx?: Prisma.TransactionClient; durationMinutes?: number;
  excludeAppointmentId?: string; exactStart?: boolean;
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


  private async context(db: Prisma.TransactionClient, businessId: string, vehicleType: string, serviceModeId: string) {
    const business = await db.business.findUnique({ where: { id: businessId }, include: { settings: true } });
    if (!business?.settings) throw new NotFoundException('Configurações de negócio não encontradas');
    const rule = await db.serviceModeRule.findFirst({ where: {
      serviceMode: { id: serviceModeId, businessId, isActive: true, deletedAt: null },
      vehicleType: { kind: vehicleType, businessId, deletedAt: null },
    } });
    if (!rule) throw new BadRequestException('Modalidade não disponível para este tipo de veículo');
    return { business, rule, zone: businessTimezone(business.timezone) };
  }

  private periods(date: string, zone: string, settings: { operatingHours: unknown; nonOperatingDates?: unknown }): TimeBlock[] {
    if (Array.isArray(settings.nonOperatingDates) && settings.nonOperatingDates.includes(date)) return [];
    const hours = settings.operatingHours as OperatingHours;
    return this.normalizeDayPeriods(hours?.[weekday(date)]).flatMap((period) => {
      const opens = localInstants(date, period.open, zone);
      const closes = localInstants(date, period.close, zone);
      // Do not silently shift nonexistent opening/closing times across DST.
      if (!opens.length || !closes.length) return [];
      return [{ start: opens[0], end: closes[closes.length - 1] }];
    });
  }

  private earliest(settings: { minimumAdvanceMinutes: number }, now: Date): Date {
    const advance = settings.minimumAdvanceMinutes ?? 15;
    if (!Number.isInteger(advance) || advance < 0) throw new BadRequestException('Antecedência mínima inválida');
    return new Date(now.getTime() + advance * 60000);
  }

  async getAvailableSlots(businessId: string, targetDate: string | Date, vehicleType: string, serviceModeId: string): Promise<AvailableSlot[]> {
    const { business, rule, zone } = await this.context(this.prisma, businessId, vehicleType, serviceModeId);
    const date = typeof targetDate === 'string' ? civilDate(targetDate) : localParts(targetDate, zone).date;
    const now = new Date();
    if (date < localParts(now, zone).date) throw new BadRequestException('Data selecionada é do passado');
    if (rule.durationMinutes <= 0) throw new BadRequestException('Duração inválida');
    const periods = this.periods(date, zone, business.settings);
    if (!periods.length) return [];
    const earliest = this.earliest(business.settings, now);
    const bounds = dayBounds(date, zone);
    const occupied = await this.occupied(this.prisma, businessId, date, zone, bounds.start, bounds.end);
    const free = periods.flatMap((period) => this.calculateFreeIntervals(period.start, period.end, occupied));
    const markers = this.extractStartMarkers(free, rule.durationMinutes);
    const slots = markers.filter((start) => start >= earliest).map((start) => {
      const end = new Date(start.getTime() + rule.durationMinutes * 60000);
      const startTime = localParts(start, zone).time, endTime = localParts(end, zone).time;
      return { startTime, endTime, displayLabel: startTime + ' - ' + endTime,
        scheduledStartAt: start.toISOString(), scheduledEndAt: end.toISOString(), timezone: zone };
    });
    // Two fall-back occurrences must remain independently selectable.
    for (const slot of slots) {
      if (slots.filter((other) => other.startTime === slot.startTime).length > 1) {
        const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
          .formatToParts(new Date(slot.scheduledStartAt)).find((part) => part.type === 'timeZoneName')!.value;
        slot.displayLabel += ' (' + offset + ')';
      }
    }
    return slots;
  }

  async getAvailabilityWithStatus(businessId: string, date: string, vehicleType: string, serviceModeId: string) {
    const slots = await this.getAvailableSlots(businessId, date, vehicleType, serviceModeId);
    const { business, zone } = await this.context(this.prisma, businessId, vehicleType, serviceModeId);
    const bounds = dayBounds(civilDate(date), zone);
    const blocks = await this.prisma.scheduleBlock.findMany({ where: {
      businessId, deletedAt: null, isActive: true, isRecurring: false,
      startAt: { lte: bounds.start }, endAt: { gte: new Date(bounds.end.getTime() - 1) },
    }, select: { id: true } });
    const closed = blocks.length > 0 || !this.periods(date, zone, business.settings).length;
    return { slots: closed ? [] : slots, closed,
      message: closed ? 'A lavação estará fechada nesta data. Escolha outra data.' : null };
  }

  async validateSlotAvailability(businessId: string, targetDate: string | Date, startTime: string,
    vehicleType: string, serviceModeId: string, options: ValidationOptions = {}): Promise<boolean> {
    const db = options.tx ?? this.prisma;
    try {
      const { business, rule, zone } = await this.context(db, businessId, vehicleType, serviceModeId);
      const date = typeof targetDate === 'string' ? civilDate(targetDate) : localParts(targetDate, zone).date;
      const candidates = options.exactStart && targetDate instanceof Date
        ? [targetDate] : localInstants(date, startTime, zone);
      // The legacy date/time-only endpoint cannot disambiguate a repeated hour.
      if (candidates.length !== 1) return false;
      const start = candidates[0];
      const duration = options.durationMinutes ?? rule.durationMinutes;
      if (!Number.isInteger(duration) || duration <= 0 || !Number.isFinite(start.getTime())) return false;
      const end = new Date(start.getTime() + duration * 60000);
      if (start < this.earliest(business.settings, new Date())) return false;
      if (!this.periods(date, zone, business.settings).some((period) => start >= period.start && end <= period.end)) return false;
      const occupied = await this.occupied(db, businessId, date, zone, start, end, options.excludeAppointmentId);
      return this.isTimeBlockFree(start, end, occupied);
    } catch (error) {
      if (options.tx) throw error;
      return false;
    }
  }

  private async occupied(db: Prisma.TransactionClient, businessId: string, date: string, zone: string,
    start: Date, end: Date, excludeAppointmentId?: string): Promise<TimeBlock[]> {
    const blocks = await db.scheduleBlock.findMany({ where: { businessId, isActive: true, deletedAt: null,
      OR: [{ startAt: { lt: end }, endAt: { gt: start } }, { isRecurring: true }] } });
    const blockIntervals = blocks.flatMap((block): TimeBlock[] => {
      if (!block.isRecurring) return [{ start: block.startAt, end: block.endAt }];
      const anchor = localParts(block.startAt, zone);
      const anchorEnd = localParts(block.endAt, zone);
      // Legacy date-only metadata is stored as UTC midnight, not a local instant.
      const lastDate = block.recurringEndDate ? block.recurringEndDate.toISOString().slice(0, 10) : null;
      const days = Array.isArray(block.recurringDays) ? block.recurringDays : [];
      const result: TimeBlock[] = [];
      // Include a recurring interval carried from the preceding civil day.
      for (const occurrence of [addCivilDays(date, -1), date]) {
        if (occurrence < anchor.date || (lastDate && occurrence > lastDate) || !days.includes(weekday(occurrence))) continue;
        if (block.type === 'FULL_DAY') { result.push(dayBounds(occurrence, zone)); continue; }
        const nextDay = anchorEnd.date > anchor.date;
        const opens = localInstants(occurrence, anchor.time, zone);
        const closes = localInstants(nextDay ? addCivilDays(occurrence, 1) : occurrence, anchorEnd.time, zone);
        if (opens.length && closes.length) {
          result.push({ start: opens[0], end: closes[closes.length - 1] });
        } else {
          // A recurring boundary can become nonexistent on a later DST date.
          // Fail closed for that day instead of silently dropping the block.
          result.push(dayBounds(occurrence, zone));
        }
      }
      return result;
    });
    const appointments = await db.appointment.findMany({ where: {
      businessId, status: { in: ['CONFIRMED', 'IN_PROGRESS'] }, deletedAt: null,
      ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
      scheduledStartAt: { lt: end }, scheduledEndAt: { gt: start },
    } });
    return this.mergeTimeBlocks([...blockIntervals,
      ...appointments.map((apt) => ({ start: apt.scheduledStartAt, end: apt.scheduledEndAt }))]);
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
