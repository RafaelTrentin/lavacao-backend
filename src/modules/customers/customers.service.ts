import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { customerResponseSelect } from './customer-response.select';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(businessId: string, customerId: string) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId, businessId },
      select: customerResponseSelect,
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
      where: { id: customerId, businessId },
      select: { businessId: true, name: true, phone: true, preferredContactMethod: true },
    });

    if (!customer || customer.businessId !== businessId) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return this.prisma.customerProfile.update({
      where: { id: customerId, businessId },
      data: {
        name: updateData.name || customer.name,
        phone: updateData.phone || customer.phone,
        preferredContactMethod:
          updateData.preferredContactMethod ||
          customer.preferredContactMethod,
      },
      select: customerResponseSelect,
    });
  }

  async getCustomersByBusiness(businessId: string) {
    return this.prisma.customerProfile.findMany({
      where: { businessId },
      select: customerResponseSelect,
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
      `cliente.${randomUUID()}@washsync.local`;

    const existingUser = await this.prisma.user.findFirst({
      where: {
        businessId,
        email: generatedEmail,
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new BadRequestException('Já existe um cliente com este email');
    }

    // Credencial de 256 bits, descartada após o hash; nunca entregue ao cliente.
    // 64 caracteres hexadecimais ficam abaixo do limite de 72 bytes do bcrypt.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: generatedEmail,
          passwordHash,
          role: 'CUSTOMER',
          businessId,
          isActive: true,
        },
        select: { id: true },
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
        select: customerResponseSelect,
      });

      return customerProfile;
    });
  }
}
