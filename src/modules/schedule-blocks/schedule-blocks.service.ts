import { businessTimezone, civilDate, dayBounds, localParts, uniqueLocalInstant, utcInstant } from '../../common/business-time';
import { Prisma } from '@prisma/client';
import { DayOfWeek, ScheduleBlockType } from '../../common/enums';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleBlockDto } from './dto/create-schedule-block.dto';
import { UpdateScheduleBlockDto } from './dto/update-schedule-block.dto';
import { withScheduleTransaction } from '../appointments/schedule-transaction';

@Injectable()
export class ScheduleBlocksService {
  constructor(private prisma: PrismaService) {}

  async createScheduleBlock(
    businessId: string,
    createScheduleBlockDto: CreateScheduleBlockDto,
  ) {
    const {
      type,
      blockDate,
      blockEndDate,
      blockStartTime,
      blockEndTime,
      reason,
      isRecurring,
      recurringDays,
      recurringEndDate,
    } = createScheduleBlockDto;

    return withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
      const zone = businessTimezone(business?.timezone);
      const date = civilDate(blockDate);
      if (blockEndDate !== undefined && (type !== 'FULL_DAY' || isRecurring)) {
        throw new BadRequestException('Período de fechamento exige dias completos sem recorrência');
      }
      const lastDate = blockEndDate === undefined ? date : civilDate(blockEndDate);
      if (lastDate < date) throw new BadRequestException('Data final anterior à data inicial');
      let startAt: Date, endAt: Date;
      if (type === 'FULL_DAY') {
        ({ start: startAt, end: endAt } = dayBounds(date, zone));
        endAt = dayBounds(lastDate, zone).end;
      } else {
        startAt = uniqueLocalInstant(date, blockStartTime || '', zone);
        endAt = uniqueLocalInstant(date, blockEndTime || '', zone);
      }
      this.validatePeriod(startAt, endAt);
      const recurrence = this.recurrence(startAt, zone, isRecurring ?? false, recurringDays, recurringEndDate);
      const block = await tx.scheduleBlock.create({ data: {
        businessId, type, startAt, endAt, reason: reason?.trim(),
        isRecurring: recurrence.isRecurring,
        recurringDays: recurrence.recurringDays,
        recurringEndDate: recurrence.recurringEndDate,
      } });
      return this.withAffectedAppointments(tx, businessId, block, zone);
    });
  }

  async updateScheduleBlock(
    blockId: string,
    businessId: string,
    updateData: UpdateScheduleBlockDto,
  ) {
    return withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const block = await tx.scheduleBlock.findUnique({
        where: { id: blockId },
      });

      if (!block || block.businessId !== businessId || block.deletedAt) {
        throw new NotFoundException('Bloqueio não encontrado');
      }

      const startAt = updateData.startAt !== undefined ? utcInstant(updateData.startAt) : block.startAt;
      const endAt = updateData.endAt !== undefined ? utcInstant(updateData.endAt) : block.endAt;
      this.validatePeriod(startAt, endAt);
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
      const zone = businessTimezone(business?.timezone);
      if ((updateData.type !== undefined || updateData.startAt !== undefined || updateData.endAt !== undefined)
          && (updateData.type ?? block.type) === ScheduleBlockType.FULL_DAY) {
        const bounds = dayBounds(localParts(startAt, zone).date, zone);
        // Accept the old inclusive 23:59:59.999 representation, without rewriting it.
        if (startAt.getTime() !== bounds.start.getTime() ||
            ![bounds.end.getTime(), bounds.end.getTime() - 1].includes(endAt.getTime())) {
          throw new BadRequestException('FULL_DAY deve abranger um dia inteiro no timezone da empresa');
        }
      }
      const isRecurring = updateData.isRecurring ?? block.isRecurring;
      const recurrence = this.recurrence(startAt, zone, isRecurring,
        updateData.recurringDays !== undefined ? updateData.recurringDays : isRecurring ? block.recurringDays : undefined,
        updateData.recurringEndDate !== undefined ? updateData.recurringEndDate : isRecurring ? block.recurringEndDate : undefined);
      return tx.scheduleBlock.update({
        where: { id: blockId, businessId, deletedAt: null },
        data: {
          type: updateData.type,
          startAt,
          endAt,
          reason: updateData.reason === undefined ? undefined : updateData.reason?.trim() ?? null,
          isRecurring: recurrence.isRecurring,
          recurringDays: recurrence.recurringDays,
          recurringEndDate: recurrence.recurringEndDate,
          isActive: updateData.isActive,
        },
      });
    });
  }

  async deleteScheduleBlock(blockId: string, businessId: string) {
    return withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const block = await tx.scheduleBlock.findUnique({
        where: { id: blockId },
      });

      if (!block || block.businessId !== businessId || block.deletedAt) {
        throw new NotFoundException('Bloqueio não encontrado');
      }

      return tx.scheduleBlock.update({
        where: { id: blockId, businessId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    });
  }

  async getScheduleBlocksByBusiness(businessId: string) {
    const blocks = await this.prisma.scheduleBlock.findMany({
      where: {
        businessId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { startAt: 'asc' },
    });
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
    return Promise.all(blocks.map((block) => this.withAffectedAppointments(this.prisma, businessId, block, businessTimezone(business?.timezone))));
  }

  private async withAffectedAppointments<T extends { type: string; isRecurring: boolean; startAt: Date; endAt: Date }>(
    db: Prisma.TransactionClient, businessId: string, block: T, zone: string,
  ) {
    if (block.type !== 'FULL_DAY' || block.isRecurring) return block;
    const affectedAppointments = await db.appointment.findMany({ where: {
      businessId, deletedAt: null, status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
      scheduledStartAt: { lt: block.endAt }, scheduledEndAt: { gt: block.startAt },
    }, select: { id: true, bookingNumber: true, scheduledStartAt: true, scheduledEndAt: true,
      status: true, customer: { select: { name: true } } }, orderBy: { scheduledStartAt: 'asc' } });
    return { ...block, blockDate: localParts(block.startAt, zone).date,
      blockEndDate: localParts(new Date(block.endAt.getTime() - 1), zone).date, timezone: zone, affectedAppointments };
  }

  private validatePeriod(start: Date, end: Date) {
    if (!Number.isFinite(start?.getTime()) || !Number.isFinite(end?.getTime()) || end <= start) {
      throw new BadRequestException('Término deve ser posterior ao início');
    }
  }

  private recurrence(start: Date, zone: string, enabled: boolean, days: unknown, until: string | Date | null | undefined) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('Recorrência inválida');
    if (!enabled) {
      if ((Array.isArray(days) && days.length) || until != null) {
        throw new BadRequestException('Dias e fim da recorrência exigem isRecurring=true');
      }
      return { isRecurring: false, recurringDays: Prisma.DbNull, recurringEndDate: null };
    }
    const normalizedDays = Array.isArray(days)
      ? days.map((day) => typeof day === 'string' ? day.trim().toUpperCase() : day) : [];
    if (!normalizedDays.length || normalizedDays.length > 7 || new Set(normalizedDays).size !== normalizedDays.length ||
        normalizedDays.some((day) => !Object.values(DayOfWeek).includes(day as DayOfWeek))) {
      throw new BadRequestException('Informe dias válidos e distintos para a recorrência');
    }
    const date = until == null ? null : civilDate((until instanceof Date ? until.toISOString() : until.trim()).slice(0, 10));
    if (date && date < localParts(start, zone).date) throw new BadRequestException('Fim da recorrência anterior ao início');
    return { isRecurring: true, recurringDays: normalizedDays as string[],
      recurringEndDate: date ? new Date(date + 'T00:00:00Z') : null };
  }

}
