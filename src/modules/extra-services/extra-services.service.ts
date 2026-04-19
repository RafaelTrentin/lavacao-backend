import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExtraServiceDto } from './dto/create-extra-service.dto';
import { CreateExtraServiceRequestDto } from './dto/create-extra-service-request.dto';
import { ExtraServiceRequestStatus } from '@prisma/client';
import { UpdateExtraServiceDto } from './dto/update-extra-service.dto';

@Injectable()
export class ExtraServicesService {
  constructor(private prisma: PrismaService) {}

  async createExtraService(
    businessId: string,
    createExtraServiceDto: CreateExtraServiceDto,
  ) {
    const normalizedName = createExtraServiceDto.name.trim();

    const existing = await this.prisma.extraService.findFirst({
      where: {
        businessId,
        name: normalizedName,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new BadRequestException('Serviço extra com este nome já existe');
    }

    const lastService = await this.prisma.extraService.findFirst({
      where: { businessId, deletedAt: null },
      orderBy: { displayOrder: 'desc' },
    });

    return this.prisma.extraService.create({
      data: {
        businessId,
        displayOrder: (lastService?.displayOrder || 0) + 1,
        estimatedPriceInCents: 0,
        isActive: true,
        ...createExtraServiceDto,
        name: normalizedName,
      },
    });
  }

  async updateExtraService(
    serviceId: string,
    businessId: string,
    updateData: UpdateExtraServiceDto,
  ) {
    const service = await this.prisma.extraService.findUnique({
      where: { id: serviceId },
    });

    if (!service || service.businessId !== businessId || service.deletedAt) {
      throw new NotFoundException('Serviço extra não encontrado');
    }

    if (updateData.name?.trim()) {
      const duplicate = await this.prisma.extraService.findFirst({
        where: {
          businessId,
          id: { not: serviceId },
          name: updateData.name.trim(),
          deletedAt: null,
        },
      });

      if (duplicate) {
        throw new BadRequestException('Serviço extra com este nome já existe');
      }
    }

    return this.prisma.extraService.update({
      where: { id: serviceId },
      data: {
        ...updateData,
        ...(updateData.name ? { name: updateData.name.trim() } : {}),
      },
    });
  }

  async deleteExtraService(serviceId: string, businessId: string) {
    const service = await this.prisma.extraService.findUnique({
      where: { id: serviceId },
    });

    if (!service || service.businessId !== businessId || service.deletedAt) {
      throw new NotFoundException('Serviço extra não encontrado');
    }

    return this.prisma.extraService.update({
      where: { id: serviceId },
      data: { deletedAt: new Date() },
    });
  }

  async getExtraServicesByBusiness(
    businessId: string,
    includeInactive = false,
  ) {
    return this.prisma.extraService.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async createExtraServiceRequest(
    businessId: string,
    customerId: string,
    createRequestDto: CreateExtraServiceRequestDto,
  ) {
    const { extraServiceId } = createRequestDto;

    const extraService = await this.prisma.extraService.findUnique({
      where: { id: extraServiceId },
    });

    if (
      !extraService ||
      extraService.businessId !== businessId ||
      extraService.deletedAt ||
      !extraService.isActive
    ) {
      throw new BadRequestException('Serviço extra não encontrado');
    }

    return this.prisma.extraServiceRequest.create({
      data: {
        businessId,
        customerId,
        extraServiceId,
        ...createRequestDto,
      },
    });
  }

  async getExtraServiceRequests(businessId: string) {
    return this.prisma.extraServiceRequest.findMany({
      where: {
        businessId,
      },
      include: {
        customer: true,
        extraService: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateExtraServiceRequestStatus(
    requestId: string,
    businessId: string,
    status: string,
  ) {
    const request = await this.prisma.extraServiceRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.businessId !== businessId) {
      throw new NotFoundException('Solicitação não encontrada');
    }

    return this.prisma.extraServiceRequest.update({
      where: { id: requestId },
      data: { status: status as ExtraServiceRequestStatus },
    });
  }
}