import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { AdminGuard } from 'src/common/guards/admin.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { CreateAdminAppointmentDto } from './dto/create-admin-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { PrismaService } from '../prisma/prisma.service';
import { EstimateSearchFeeDto } from './dto/estimate-search-fee.dto';

@Controller('appointments')
@UseGuards(JwtGuard)
export class AppointmentsController {
  constructor(
    private appointmentsService: AppointmentsService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.appointmentsService.createAppointment(
      user.businessId,
      customerProfile.id,
      user.userId,
      createAppointmentDto,
    );
  }

  @Post('admin')
  @UseGuards(AdminGuard)
  async createByAdmin(
    @Body() createAdminAppointmentDto: CreateAdminAppointmentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: createAdminAppointmentDto.customerId },
    });

    if (!customer || customer.businessId !== user.businessId) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return this.appointmentsService.createAppointment(
      user.businessId,
      customer.id,
      user.userId,
      createAdminAppointmentDto.appointment,
    );
  }

  @Get()
  async getMyAppointments(@CurrentUser() user: CurrentUserPayload) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.appointmentsService.getCustomerAppointments(
      customerProfile.id,
      user.businessId,
    );
  }

  @Get(':id')
  async getById(
    @Param('id') appointmentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (user.role === 'ADMIN') {
      return this.appointmentsService.getAppointmentById(
        appointmentId,
        user.businessId,
      );
    }

    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.appointmentsService.getCustomerAppointmentById(
      appointmentId,
      user.businessId,
      customerProfile.id,
    );
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') appointmentId: string,
    @Body() cancelDto: CancelAppointmentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.appointmentsService.cancelAppointment(
      appointmentId,
      user.businessId,
      user.userId,
      user.role,
      cancelDto.reason,
    );
  }

  @Post(':id/reschedule')
  async reschedule(
    @Param('id') appointmentId: string,
    @Body() rescheduleDto: RescheduleAppointmentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const newScheduledStartAt = new Date(rescheduleDto.newScheduledStartAt);

    if (isNaN(newScheduledStartAt.getTime())) {
      throw new BadRequestException('Data/hora inválida');
    }

    if (user.role === 'ADMIN') {
      return this.appointmentsService.rescheduleAppointment(
        appointmentId,
        user.businessId,
        newScheduledStartAt,
        user.userId,
      );
    }

    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.appointmentsService.rescheduleCustomerAppointment(
      appointmentId,
      user.businessId,
      customerProfile.id,
      newScheduledStartAt,
    );
  }

  @Post(':id/start')
  @UseGuards(AdminGuard)
  async start(
    @Param('id') appointmentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.appointmentsService.startAppointment(
      appointmentId,
      user.businessId,
      user.userId,
    );
  }

  @Post(':id/complete')
  @UseGuards(AdminGuard)
  async complete(
    @Param('id') appointmentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.appointmentsService.completeAppointment(
      appointmentId,
      user.businessId,
      user.userId,
    );
  }

  @Get('admin/date/:date')
  @UseGuards(AdminGuard)
  async getAppointmentsByDate(
    @Param('date') dateStr: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const date = this.parseLocalDate(dateStr);

    if (!date) {
      throw new BadRequestException('Data inválida');
    }

    return this.appointmentsService.getAppointmentsByDate(
      user.businessId,
      date,
    );
  }

  @Post('estimate-search-fee')
  async estimateSearchFee(
    @Body() estimateDto: EstimateSearchFeeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.appointmentsService.estimateSearchFee(
      user.businessId,
      customerProfile.id,
      estimateDto,
    );
  }

  private parseLocalDate(dateStr: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);

    const date = new Date(year, month, day, 0, 0, 0, 0);

    if (isNaN(date.getTime())) return null;

    return date;
  }
}