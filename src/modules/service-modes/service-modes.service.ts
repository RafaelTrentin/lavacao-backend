import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceModeDto } from './dto/create-service-mode.dto';
import { UpdateServiceModeDto } from './dto/update-service-mode.dto';
import { ServiceModeRuleDto } from './dto/service-mode-rule.dto';

@Injectable()
export class ServiceModesService {
  constructor(private prisma: PrismaService) {}

  async createServiceMode(
    businessId: string,
    createServiceModeDto: CreateServiceModeDto,
  ) {
    const normalizedName = createServiceModeDto.name.trim();

    const existing = await this.prisma.serviceMode.findFirst({
      where: {
        businessId,
        name: normalizedName,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new BadRequestException('Modalidade com este nome já existe');
    }

    const lastMode = await this.prisma.serviceMode.findFirst({
      where: {
        businessId,
        deletedAt: null,
      },
      orderBy: { displayOrder: 'desc' },
    });

    return this.prisma.serviceMode.create({
      data: {
        businessId,
        name: normalizedName,
        description: createServiceModeDto.description,
        isActive: createServiceModeDto.isActive,
        displayOrder: (lastMode?.displayOrder || 0) + 1,
      },
      include: {
        rules: {
          include: { vehicleType: true },
        },
      },
    });
  }

  async updateServiceMode(
    serviceModeId: string,
    businessId: string,
    updateServiceModeDto: UpdateServiceModeDto,
  ) {
    const serviceMode = await this.prisma.serviceMode.findUnique({
      where: { id: serviceModeId },
    });

    if (
      !serviceMode ||
      serviceMode.businessId !== businessId ||
      serviceMode.deletedAt
    ) {
      throw new NotFoundException('Modalidade não encontrada');
    }

    if (updateServiceModeDto.name?.trim()) {
      const normalizedName = updateServiceModeDto.name.trim();

      const existing = await this.prisma.serviceMode.findFirst({
        where: {
          businessId,
          name: normalizedName,
          NOT: { id: serviceModeId },
          deletedAt: null,
        },
      });

      if (existing) {
        throw new BadRequestException('Modalidade com este nome já existe');
      }
    }

    return this.prisma.serviceMode.update({
      where: { id: serviceModeId },
      data: {
        ...(updateServiceModeDto.name
          ? { name: updateServiceModeDto.name.trim() }
          : {}),
        ...(updateServiceModeDto.description !== undefined
          ? { description: updateServiceModeDto.description }
          : {}),
        ...(updateServiceModeDto.isActive !== undefined
          ? { isActive: updateServiceModeDto.isActive }
          : {}),
      },
      include: {
        rules: {
          include: { vehicleType: true },
        },
      },
    });
  }

  async deleteServiceMode(serviceModeId: string, businessId: string) {
    const serviceMode = await this.prisma.serviceMode.findUnique({
      where: { id: serviceModeId },
    });

    if (
      !serviceMode ||
      serviceMode.businessId !== businessId ||
      serviceMode.deletedAt
    ) {
      throw new NotFoundException('Modalidade não encontrada');
    }

    return this.prisma.serviceMode.update({
      where: { id: serviceModeId },
      data: { deletedAt: new Date() },
    });
  }

  async createServiceModeRule(
    serviceModeId: string,
    businessId: string,
    ruleDto: ServiceModeRuleDto,
  ) {
    const { vehicleTypeKind, durationMinutes, basePriceInCents } = ruleDto;

    const serviceMode = await this.prisma.serviceMode.findUnique({
      where: { id: serviceModeId },
    });

    if (
      !serviceMode ||
      serviceMode.businessId !== businessId ||
      serviceMode.deletedAt
    ) {
      throw new NotFoundException('Modalidade não encontrada');
    }

    const vehicleType = await this.prisma.vehicleType.findFirst({
      where: {
        businessId,
        kind: vehicleTypeKind,
        deletedAt: null,
      },
    });

    if (!vehicleType) {
      throw new NotFoundException('Tipo de veículo não encontrado');
    }

    const existing = await this.prisma.serviceModeRule.findUnique({
      where: {
        serviceModeId_vehicleTypeId: {
          serviceModeId,
          vehicleTypeId: vehicleType.id,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'Já existe regra para este tipo de veículo nesta modalidade',
      );
    }

    return this.prisma.serviceModeRule.create({
      data: {
        serviceModeId,
        vehicleTypeId: vehicleType.id,
        durationMinutes,
        basePriceInCents,
      },
      include: {
        vehicleType: true,
      },
    });
  }

  async updateServiceModeRule(
    ruleId: string,
    businessId: string,
    durationMinutes: number,
    basePriceInCents: number,
  ) {
    const rule = await this.prisma.serviceModeRule.findUnique({
      where: { id: ruleId },
      include: { serviceMode: true, vehicleType: true },
    });

    if (
      !rule ||
      !rule.serviceMode ||
      rule.serviceMode.businessId !== businessId ||
      rule.serviceMode.deletedAt
    ) {
      throw new NotFoundException('Regra não encontrada');
    }

    if (
      !rule.vehicleType ||
      rule.vehicleType.businessId !== businessId ||
      rule.vehicleType.deletedAt
    ) {
      throw new NotFoundException('Tipo de veículo não encontrado');
    }

    return this.prisma.serviceModeRule.update({
      where: { id: ruleId },
      data: { durationMinutes, basePriceInCents },
      include: {
        vehicleType: true,
      },
    });
  }

  async getServiceModesByBusiness(
    businessId: string,
    includeInactive = false,
  ) {
    return this.prisma.serviceMode.findMany({
      where: {
        businessId,
        ...(includeInactive ? {} : { isActive: true }),
        deletedAt: null,
      },
      include: {
        rules: {
          include: { vehicleType: true },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getServiceModeById(serviceModeId: string, businessId: string) {
    const serviceMode = await this.prisma.serviceMode.findUnique({
      where: { id: serviceModeId },
      include: {
        rules: {
          include: { vehicleType: true },
        },
      },
    });

    if (
      !serviceMode ||
      serviceMode.businessId !== businessId ||
      serviceMode.deletedAt
    ) {
      throw new NotFoundException('Modalidade não encontrada');
    }

    return serviceMode;
  }
}