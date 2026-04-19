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
import { AdminGuard } from 'src/common/guards/admin.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { ExtraServicesService } from './extra-services.service';
import { CreateExtraServiceDto } from './dto/create-extra-service.dto';
import { CreateExtraServiceRequestDto } from './dto/create-extra-service-request.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateExtraServiceDto } from './dto/update-extra-service.dto';

@Controller('extra-services')
@UseGuards(JwtGuard)
export class ExtraServicesController {
  constructor(
    private extraServicesService: ExtraServicesService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async getAll(@CurrentUser() user: CurrentUserPayload) {
    return this.extraServicesService.getExtraServicesByBusiness(
      user.businessId,
      user.role === 'ADMIN',
    );
  }

  @Post('requests')
  async createRequest(
    @Body() createRequestDto: CreateExtraServiceRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.extraServicesService.createExtraServiceRequest(
      user.businessId,
      customerProfile.id,
      createRequestDto,
    );
  }

  @Get('requests')
  @UseGuards(AdminGuard)
  async getRequests(@CurrentUser() user: CurrentUserPayload) {
    return this.extraServicesService.getExtraServiceRequests(user.businessId);
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(
    @Body() createExtraServiceDto: CreateExtraServiceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.extraServicesService.createExtraService(
      user.businessId,
      createExtraServiceDto,
    );
  }

  @Put(':id')
@UseGuards(AdminGuard)
async update(
  @Param('id') serviceId: string,
  @Body() updateExtraServiceDto: UpdateExtraServiceDto,
  @CurrentUser() user: CurrentUserPayload,
) {
  return this.extraServicesService.updateExtraService(
    serviceId,
    user.businessId,
    updateExtraServiceDto,
  );
}

  @Delete(':id')
  @UseGuards(AdminGuard)
  async delete(
    @Param('id') serviceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.extraServicesService.deleteExtraService(
      serviceId,
      user.businessId,
    );
  }

  @Put('requests/:id/status')
  @UseGuards(AdminGuard)
  async updateRequestStatus(
    @Param('id') requestId: string,
    @Body() statusData: { status: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.extraServicesService.updateExtraServiceRequestStatus(
      requestId,
      user.businessId,
      statusData.status,
    );
  }
}