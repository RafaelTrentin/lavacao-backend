import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleBlockDto } from './dto/create-schedule-block.dto';

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
      blockStartTime,
      blockEndTime,
      reason,
      isRecurring,
      recurringDays,
      recurringEndDate,
    } = createScheduleBlockDto;

    let startAt: Date;
    let endAt: Date;

    if (type === 'FULL_DAY') {
      startAt = new Date(blockDate);
      startAt.setHours(0, 0, 0, 0);
      endAt = new Date(blockDate);
      endAt.setHours(23, 59, 59, 999);
    } else {
      if (!blockStartTime || !blockEndTime) {
        throw new BadRequestException(
          'blockStartTime e blockEndTime são obrigatórios para TIME_RANGE',
        );
      }

      startAt = this.combineDateTime(new Date(blockDate), blockStartTime);
      endAt = this.combineDateTime(new Date(blockDate), blockEndTime);
    }

    if (endAt <= startAt) {
      throw new BadRequestException('Hora de término deve ser após hora de início');
    }

    return this.prisma.scheduleBlock.create({
      data: {
        businessId,
        type,
        startAt,
        endAt,
        reason,
        isRecurring,
        recurringDays: isRecurring ? recurringDays : null,
        recurringEndDate: isRecurring ? new Date(recurringEndDate!) : null,
      },
    });
  }

  async updateScheduleBlock(
    blockId: string,
    businessId: string,
    updateData: any,
  ) {
    const block = await this.prisma.scheduleBlock.findUnique({
      where: { id: blockId },
    });

    if (!block || block.businessId !== businessId) {
      throw new NotFoundException('Bloqueio não encontrado');
    }

    return this.prisma.scheduleBlock.update({
      where: { id: blockId },
      data: updateData,
    });
  }

  async deleteScheduleBlock(blockId: string, businessId: string) {
    const block = await this.prisma.scheduleBlock.findUnique({
      where: { id: blockId },
    });

    if (!block || block.businessId !== businessId) {
      throw new NotFoundException('Bloqueio não encontrado');
    }

    return this.prisma.scheduleBlock.update({
      where: { id: blockId },
      data: { deletedAt: new Date() },
    });
  }

  async getScheduleBlocksByBusiness(businessId: string) {
    return this.prisma.scheduleBlock.findMany({
      where: {
        businessId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { startAt: 'asc' },
    });
  }

  private combineDateTime(date: Date, timeStr: string): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }
}