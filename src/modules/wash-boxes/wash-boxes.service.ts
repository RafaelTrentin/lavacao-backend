import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withScheduleTransaction } from '../appointments/schedule-transaction';
import { CreateWashBoxDto, UpdateWashBoxDto } from './wash-box.dto';

const publicBox = { id: true, name: true, isActive: true, isLegacyDefault: true, serviceModeIds: true } as const;

@Injectable()
export class WashBoxesService {
  constructor(private prisma: PrismaService) {}

  list(businessId: string) {
    return this.prisma.washBox.findMany({ where: { businessId }, select: publicBox,
      orderBy: [{ isLegacyDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  }

  private async validate(tx: Prisma.TransactionClient, businessId: string, name: string,
    isActive: boolean, ids: string[], boxId?: string, isLegacyDefault = false) {
    if (ids.length && await tx.serviceMode.count({ where: { businessId, id: { in: ids }, isActive: true, deletedAt: null } }) !== ids.length) {
      throw new BadRequestException('Selecione apenas serviços ativos desta lavação');
    }
    if (await tx.washBox.findFirst({ where: { businessId, name, ...(boxId ? { id: { not: boxId } } : {}) } })) {
      throw new BadRequestException('Já existe um box com este nome');
    }
    const pending = await tx.appointment.findMany({ where: {
      businessId, deletedAt: null, status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
      OR: [...(boxId ? [{ boxId }] : []), ...(isLegacyDefault ? [{ boxId: null }] : [])],
      AND: [{ OR: [{ scheduledEndAt: { gt: new Date() } }, { status: 'IN_PROGRESS' }, { arrivedAt: { not: null } }] }],
    }, select: { serviceModeId: true } });
    if (pending.some((apt) => !isActive || (ids.length > 0 && !ids.includes(apt.serviceModeId)))) {
      throw new BadRequestException('Este box possui atendimentos incompatíveis com a alteração. Reagende ou cancele esses atendimentos primeiro.');
    }
  }

  create(businessId: string, dto: CreateWashBoxDto) {
    return withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const isLegacyDefault = await tx.washBox.count({ where: { businessId } }) === 0;
      const name = dto.name.trim(), isActive = dto.isActive ?? true, serviceModeIds = dto.serviceModeIds ?? [];
      await this.validate(tx, businessId, name, isActive, serviceModeIds, undefined, isLegacyDefault);
      return tx.washBox.create({ data: { businessId, name, isActive, serviceModeIds, isLegacyDefault }, select: publicBox });
    });
  }

  update(businessId: string, id: string, dto: UpdateWashBoxDto) {
    return withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const box = await tx.washBox.findFirst({ where: { businessId, id } });
      if (!box) throw new NotFoundException('Box não encontrado');
      const name = dto.name?.trim() ?? box.name;
      const isActive = dto.isActive ?? box.isActive, serviceModeIds = dto.serviceModeIds ?? box.serviceModeIds;
      await this.validate(tx, businessId, name, isActive, serviceModeIds, id, box.isLegacyDefault);
      return tx.washBox.update({ where: { id, businessId }, data: { name, isActive, serviceModeIds }, select: publicBox });
    });
  }
}
