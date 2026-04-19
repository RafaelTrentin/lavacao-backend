import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(businessId: string, customerId: string) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
      include: {
        user: true,
        addresses: true,
      },
    });

    if (!customer || customer.businessId !== businessId) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return customer;
  }

  async updateProfile(
    businessId: string,
    customerId: string,
    updateData: CreateCustomerDto,
  ) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
    });

    if (!customer || customer.businessId !== businessId) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return this.prisma.customerProfile.update({
      where: { id: customerId },
      data: {
        name: updateData.name || customer.name,
        phone: updateData.phone || customer.phone,
        preferredContactMethod:
          updateData.preferredContactMethod ||
          customer.preferredContactMethod,
      },
      include: {
        user: true,
        addresses: true,
      },
    });
  }

  async getCustomersByBusiness(businessId: string) {
    return this.prisma.customerProfile.findMany({
      where: { businessId },
      include: {
        user: true,
        addresses: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async createQuickCustomer(businessId: string, data: CreateCustomerDto) {
    if (!data.name?.trim()) {
      throw new BadRequestException('Nome é obrigatório');
    }

    if (!data.phone?.trim()) {
      throw new BadRequestException('Telefone é obrigatório');
    }

    const generatedEmail =
      data.email?.trim().toLowerCase() ||
      `cliente.${Date.now()}@washhub.local`;

    const existingUser = await this.prisma.user.findFirst({
      where: {
        businessId,
        email: generatedEmail,
      },
    });

    if (existingUser) {
      throw new BadRequestException('Já existe um cliente com este email');
    }

    const passwordHash = await bcrypt.hash('123456', 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: generatedEmail,
          passwordHash,
          role: 'CUSTOMER',
          businessId,
          isActive: true,
        },
      });

      const customerProfile = await tx.customerProfile.create({
        data: {
          userId: user.id,
          businessId,
          name: data.name.trim(),
          phone: data.phone.trim(),
          preferredContactMethod:
            data.preferredContactMethod || 'WHATSAPP',
        },
        include: {
          user: true,
          addresses: true,
        },
      });

      return customerProfile;
    });
  }
}