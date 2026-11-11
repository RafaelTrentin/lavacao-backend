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
        streetAddress: createAddressDto.streetAddress,
        number: createAddressDto.number,
        complement: createAddressDto.complement,
        neighborhood: createAddressDto.neighborhood,
        city: createAddressDto.city,
        state: createAddressDto.state,
        zipCode: createAddressDto.zipCode,
        latitude: createAddressDto.latitude,
        longitude: createAddressDto.longitude,
        addressType: createAddressDto.addressType,
        isDefault: createAddressDto.isDefault,
        label: createAddressDto.label,
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
      where: { id: addressId, businessId, customerId, deletedAt: null },
      data: {
        streetAddress: updateData.streetAddress,
        number: updateData.number,
        complement: updateData.complement,
        neighborhood: updateData.neighborhood,
        city: updateData.city,
        state: updateData.state,
        zipCode: updateData.zipCode,
        latitude: updateData.latitude,
        longitude: updateData.longitude,
        addressType: updateData.addressType,
        isDefault: updateData.isDefault,
        label: updateData.label,
      },
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
      where: { id: addressId, businessId, customerId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}