import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('addresses')
@UseGuards(JwtGuard)
export class AddressesController {
  constructor(
    private addressesService: AddressesService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async create(
    @Body() createAddressDto: CreateAddressDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.addressesService.createAddress(
      user.businessId,
      customerProfile.id,
      createAddressDto,
    );
  }

  @Get()
  async getAll(@CurrentUser() user: CurrentUserPayload) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.addressesService.getAddressesByCustomer(
      user.businessId,
      customerProfile.id,
    );
  }

  @Put(':id')
  async update(
    @Param('id') addressId: string,
    @Body() updateAddressDto: CreateAddressDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.addressesService.updateAddress(
      addressId,
      user.businessId,
      customerProfile.id,
      updateAddressDto,
    );
  }

  @Delete(':id')
  async delete(
    @Param('id') addressId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.addressesService.deleteAddress(
      addressId,
      user.businessId,
      customerProfile.id,
    );
  }
}