import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { AdminGuard } from 'src/common/guards/admin.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('customers')
@UseGuards(JwtGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: CurrentUserPayload) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.customersService.getProfile(
      user.businessId,
      customerProfile.id,
    );
  }

  @Put('profile')
  async updateProfile(
    @Body() updateData: CreateCustomerDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.customersService.updateProfile(
      user.businessId,
      customerProfile.id,
      updateData,
    );
  }

  @Get('admin/list')
  @UseGuards(AdminGuard)
  async getCustomersForAdmin(@CurrentUser() user: CurrentUserPayload) {
    return this.customersService.getCustomersByBusiness(user.businessId);
  }

  @Post('admin/quick')
  @UseGuards(AdminGuard)
  async createQuickCustomer(
    @Body() createCustomerDto: CreateCustomerDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customersService.createQuickCustomer(
      user.businessId,
      createCustomerDto,
    );
  }
}