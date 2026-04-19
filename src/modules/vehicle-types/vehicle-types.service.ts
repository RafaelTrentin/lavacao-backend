import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleTypeDto } from './dto/create-vehicle-type.dto';
import { UpdateVehicleTypeDto } from './dto/update-vehicle-type.dto';

@Injectable()
export class VehicleTypesService {
  constructor(private prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.vehicleType.findMany({
      where: {
        businessId,
        deletedAt: null,
      },
      orderBy: { displayName: 'asc' },
    });
  }

  async create(businessId: string, data: CreateVehicleTypeDto) {
    const kind = data.kind.trim().toUpperCase();
    const displayName = data.displayName.trim();

    const existing = await this.prisma.vehicleType.findFirst({
      where: {
        businessId,
        kind,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new BadRequestException(
        'Já existe um tipo de veículo com esse código',
      );
    }

    return this.prisma.vehicleType.create({
      data: {
        businessId,
        kind,
        displayName,
      },
    });
  }

  async update(id: string, businessId: string, data: UpdateVehicleTypeDto) {
    const current = await this.prisma.vehicleType.findUnique({
      where: { id },
    });

    if (!current || current.businessId !== businessId || current.deletedAt) {
      throw new NotFoundException('Tipo de veículo não encontrado');
    }

    const nextKind = data.kind?.trim().toUpperCase();

    if (nextKind && nextKind !== current.kind) {
      const existing = await this.prisma.vehicleType.findFirst({
        where: {
          businessId,
          kind: nextKind,
          NOT: { id },
          deletedAt: null,
        },
      });

      if (existing) {
        throw new BadRequestException(
          'Já existe um tipo de veículo com esse código',
        );
      }
    }

    return this.prisma.vehicleType.update({
      where: { id },
      data: {
        ...(nextKind ? { kind: nextKind } : {}),
        ...(data.displayName !== undefined
          ? { displayName: data.displayName.trim() }
          : {}),
      },
    });
  }

  async delete(id: string, businessId: string) {
    const current = await this.prisma.vehicleType.findUnique({
      where: { id },
    });

    if (!current || current.businessId !== businessId || current.deletedAt) {
      throw new NotFoundException('Tipo de veículo não encontrado');
    }

    const rulesCount = await this.prisma.serviceModeRule.count({
      where: {
        vehicleTypeId: id,
        serviceMode: {
          businessId,
          deletedAt: null,
        },
      },
    });

    if (rulesCount > 0) {
      throw new BadRequestException(
        'Este tipo de veículo já está em uso nas modalidades e não pode ser excluído',
      );
    }

    return this.prisma.vehicleType.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}