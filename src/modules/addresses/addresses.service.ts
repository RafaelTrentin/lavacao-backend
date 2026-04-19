import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  async createAddress(
    businessId: string,
    customerId: string,
    createAddressDto: CreateAddressDto,
  ) {
    return this.prisma.address.create({
      data: {
        businessId,
        customerId,
        ...createAddressDto,
      },
    });
  }

  async getAddressesByCustomer(businessId: string, customerId: string) {
    return this.prisma.address.findMany({
      where: {
        businessId,
        customerId,
        deletedAt: null,
      },
    });
  }

  async updateAddress(
    addressId: string,
    businessId: string,
    customerId: string,
    updateData: CreateAddressDto,
  ) {
    const address = await this.prisma.address.findUnique({
      where: { id: addressId },
    });

    if (
      !address ||
      address.businessId !== businessId ||
      address.customerId !== customerId ||
      address.deletedAt
    ) {
      throw new NotFoundException('Endereço não encontrado');
    }

    return this.prisma.address.update({
      where: { id: addressId },
      data: updateData,
    });
  }

  async deleteAddress(
    addressId: string,
    businessId: string,
    customerId: string,
  ) {
    const address = await this.prisma.address.findUnique({
      where: { id: addressId },
    });

    if (
      !address ||
      address.businessId !== businessId ||
      address.customerId !== customerId ||
      address.deletedAt
    ) {
      throw new NotFoundException('Endereço não encontrado');
    }

    return this.prisma.address.update({
      where: { id: addressId },
      data: { deletedAt: new Date() },
    });
  }
}