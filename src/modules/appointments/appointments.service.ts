import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  Prisma,
  AppointmentStatus,
  SearchType,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { MapsService } from '../maps/maps.service';
import { EstimateSearchFeeDto } from './dto/estimate-search-fee.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
    private mapsService: MapsService,
    private notificationsService: NotificationsService,
    private pushNotificationsService: PushNotificationsService,
  ) {}

  async createAppointment(
    businessId: string,
    customerId: string,
    userId: string,
    createAppointmentDto: CreateAppointmentDto,
  ) {
    const {
      serviceModeId,
      vehicleType,
      scheduledStartAt,
      willSearchVehicle,
      searchType,
      serviceAddressId,
      pickupReference,
      streetAddress,
      number,
      complement,
      neighborhood,
      city,
      state,
      zipCode,
      addressType,
      addressLabel,
      latitude,
      longitude,
    } = createAppointmentDto;

    if (!scheduledStartAt) {
      throw new BadRequestException('Data e hora são obrigatórios');
    }

    const scheduledDate = new Date(scheduledStartAt);
    if (isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Data/hora inválida');
    }

    const serviceMode = await this.prisma.serviceMode.findUnique({
      where: { id: serviceModeId },
    });

    if (
      !serviceMode ||
      serviceMode.businessId !== businessId ||
      !serviceMode.isActive
    ) {
      throw new BadRequestException('Modalidade inválida ou desativada');
    }

    const serviceRule = await this.prisma.serviceModeRule.findFirst({
      where: {
        serviceMode: { id: serviceModeId, businessId },
        vehicleType: { kind: vehicleType },
      },
    });

    if (!serviceRule) {
      throw new BadRequestException(
        'Modalidade não disponível para este tipo de veículo',
      );
    }

    type TempAddressSnapshot = {
      streetAddress: string;
      number: string;
      complement: string | null;
      neighborhood: string;
      city: string;
      state: string;
      zipCode: string;
      latitude: Prisma.Decimal | null;
      longitude: Prisma.Decimal | null;
      addressType: any;
      label: string | null;
    };

    let selectedAddress: TempAddressSnapshot | null = null;
    let calculatedDistanceKm = 0;
    let searchFeeInCents = 0;

    if (willSearchVehicle) {
  if (!searchType) {
    throw new BadRequestException(
      'searchType é obrigatório quando willSearchVehicle é true',
    );
  }

  if (searchType === SearchType.CURRENT_LOCATION) {
    const estimate = await this.estimateSearchFee(businessId, customerId, {
      serviceModeId,
      vehicleType,
      willSearchVehicle,
      searchType,
      serviceAddressId,
      latitude,
      longitude,
      pickupReference,
    });

    calculatedDistanceKm = estimate.distanceKm;
    searchFeeInCents = estimate.searchFeeInCents;
  }

  if (searchType === SearchType.MANUAL_ADDRESS) {
    calculatedDistanceKm = 0;
    searchFeeInCents = 0;
  }

      if (searchType === SearchType.CURRENT_LOCATION) {
        selectedAddress = {
          streetAddress: 'Localização atual',
          number: '',
          complement: pickupReference || null,
          neighborhood: '',
          city: '',
          state: '',
          zipCode: '',
          latitude:
            typeof latitude === 'number' ? new Prisma.Decimal(latitude) : null,
          longitude:
            typeof longitude === 'number' ? new Prisma.Decimal(longitude) : null,
          addressType: 'OTHER',
          label: 'Localização atual',
        };
      }

      if (searchType === SearchType.MANUAL_ADDRESS) {
        if (serviceAddressId) {
          const savedAddress = await this.prisma.address.findUnique({
            where: { id: serviceAddressId },
          });

          if (
            !savedAddress ||
            savedAddress.businessId !== businessId ||
            savedAddress.customerId !== customerId
          ) {
            throw new BadRequestException(
              'Endereço inválido, não encontrado ou não autorizado',
            );
          }

          selectedAddress = {
            streetAddress: savedAddress.streetAddress,
            number: savedAddress.number,
            complement: savedAddress.complement,
            neighborhood: savedAddress.neighborhood,
            city: savedAddress.city,
            state: savedAddress.state,
            zipCode: savedAddress.zipCode,
            latitude: savedAddress.latitude,
            longitude: savedAddress.longitude,
            addressType: savedAddress.addressType,
            label: savedAddress.label,
          };
        } else {
          selectedAddress = {
  streetAddress: streetAddress || '',
  number: number || '',
  complement: complement || null,
  neighborhood: neighborhood || '',
  city: city || '',
  state: state || '',
  zipCode: zipCode || '',
  latitude: null,
  longitude: null,
  addressType: addressType || 'OTHER',
  label: addressLabel || 'Endereço manual',
};
        }
      }
    }

    const isAvailable = await this.availabilityService.validateSlotAvailability(
      businessId,
      scheduledDate,
      this.formatTime(scheduledDate),
      vehicleType,
      serviceModeId,
    );

    if (!isAvailable) {
      throw new BadRequestException(
        'Horário não está mais disponível. Por favor, escolha outro.',
      );
    }

    const durationMinutes = serviceRule.durationMinutes;
    const scheduledEndAt = new Date(
      scheduledDate.getTime() + durationMinutes * 60000,
    );

    const basePrice = serviceRule.basePriceInCents;
    const totalPriceInCents = basePrice + searchFeeInCents;

    const bookingNumber = this.generateBookingNumber();

    const appointment = await this.prisma.$transaction(
      async (tx) => {
        const conflicting = await tx.appointment.findMany({
          where: {
            businessId,
            status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
            scheduledStartAt: { lt: scheduledEndAt },
            scheduledEndAt: { gt: scheduledDate },
            deletedAt: null,
          },
        });

        if (conflicting.length > 0) {
          throw new ConflictException(
            'Horário foi reservado por outro cliente. Tente novamente.',
          );
        }

        const newAppointment = await tx.appointment.create({
          data: {
            businessId,
            customerId,
            serviceModeId,
            vehicleType,
            status: AppointmentStatus.CONFIRMED,

            scheduledStartAt: scheduledDate,
            scheduledEndAt,

            snapshotServiceModeName: serviceMode.name,
            snapshotDurationMinutes: durationMinutes,
            snapshotBasePriceInCents: basePrice,
            snapshotTotalPriceInCents: totalPriceInCents,

            willSearchVehicle,
            searchType: willSearchVehicle ? searchType : null,
            snapshotSearchFeeInCents: searchFeeInCents,
            snapshotDistanceKm: willSearchVehicle
              ? new Prisma.Decimal(calculatedDistanceKm)
              : null,

            ...(willSearchVehicle &&
              selectedAddress && {
                snapshotAddressLine: selectedAddress.streetAddress,
                snapshotAddressNumber: selectedAddress.number,
                snapshotAddressComplement: selectedAddress.complement,
                snapshotNeighborhood: selectedAddress.neighborhood,
                snapshotCity: selectedAddress.city,
                snapshotState: selectedAddress.state,
                snapshotZipCode: selectedAddress.zipCode,
                snapshotLatitude: selectedAddress.latitude,
                snapshotLongitude: selectedAddress.longitude,
                snapshotAddressType: selectedAddress.addressType,
                snapshotAddressLabel: selectedAddress.label,
                snapshotPickupReference: pickupReference || null,
              }),

            bookingNumber,
            createdByUserId: userId,
            confirmedAt: new Date(),
            serviceRuleId: serviceRule.id,
          },
          include: {
            customer: true,
            serviceRule: { include: { serviceMode: true } },
          },
        });

        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: newAppointment.id,
            oldStatus: null,
            newStatus: AppointmentStatus.CONFIRMED,
            reason: 'Agendamento criado',
          },
        });

        return newAppointment;
      },
      {
        timeout: 10000,
      },
    );

    return this.serializeAppointment(appointment);
  }

  async cancelAppointment(
    appointmentId: string,
    businessId: string,
    userId: string,
    userRole: string,
    reason?: string,
  ) {
    const appointment = await this.getAppointmentById(appointmentId, businessId);

    if (userRole === 'CUSTOMER') {
      const customer = await this.prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customer || appointment.customerId !== customer.id) {
        throw new BadRequestException(
          'Você não pode cancelar este agendamento',
        );
      }
    }

    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException(
        'Apenas agendamentos confirmados podem ser cancelados',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const oldStatus = appointment.status;

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          oldStatus,
          newStatus: AppointmentStatus.CANCELLED,
          reason: reason || 'Cancelado pelo usuário',
        },
      });

      await this.notificationsService.createForUser({
        businessId,
        userId: appointment.customer.userId,
        appointmentId: appointment.id,
        type: NotificationType.APPOINTMENT_CANCELLED,
        title: 'Agendamento cancelado',
        message: `Seu agendamento #${appointment.bookingNumber} foi cancelado.`,
      });

      await this.pushNotificationsService.sendToUser({
        userId: appointment.customer.userId,
        businessId,
        title: 'Agendamento cancelado',
        body: `Seu agendamento #${appointment.bookingNumber} foi cancelado.`,
        url: '/notifications',
      });

      return updated;
    });
  }

  async rescheduleAppointment(
    appointmentId: string,
    businessId: string,
    newScheduledStartAt: Date,
    adminId?: string,
  ) {
    const appointment = await this.getAppointmentById(appointmentId, businessId);

    const reschedulableStatuses: AppointmentStatus[] = [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.NO_SHOW,
    ];

    if (!reschedulableStatuses.includes(appointment.status)) {
      throw new BadRequestException(
        `Agendamento com status ${appointment.status} não pode ser reagendado`,
      );
    }

    const isAvailable = await this.availabilityService.validateSlotAvailability(
      businessId,
      newScheduledStartAt,
      this.formatTime(newScheduledStartAt),
      appointment.vehicleType as any,
      appointment.serviceModeId,
    );

    if (!isAvailable) {
      throw new BadRequestException('Novo horário não está disponível');
    }

    const newScheduledEndAt = new Date(
      newScheduledStartAt.getTime() +
        appointment.snapshotDurationMinutes * 60000,
    );

    return this.prisma.$transaction(async (tx) => {
      const oldStatus = appointment.status;

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          scheduledStartAt: newScheduledStartAt,
          scheduledEndAt: newScheduledEndAt,
          status: AppointmentStatus.CONFIRMED,
          confirmedAt: new Date(),
          ...(adminId && {
            modifiedByAdminId: adminId,
            modifiedAt: new Date(),
          }),
        },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          oldStatus,
          newStatus: AppointmentStatus.CONFIRMED,
          reason: 'Reagendado',
        },
      });

      await this.notificationsService.createForUser({
        businessId,
        userId: appointment.customer.userId,
        appointmentId: appointment.id,
        type: NotificationType.APPOINTMENT_RESCHEDULED,
        title: 'Agendamento reagendado',
        message: `Seu agendamento #${appointment.bookingNumber} foi reagendado para ${this.formatNotificationDate(newScheduledStartAt)}.`,
      });

      await this.pushNotificationsService.sendToUser({
        userId: appointment.customer.userId,
        businessId,
        title: 'Agendamento reagendado',
        body: `Seu agendamento #${appointment.bookingNumber} foi reagendado para ${this.formatNotificationDate(newScheduledStartAt)}.`,
        url: '/notifications',
      });

      return updated;
    });
  }

  async rescheduleCustomerAppointment(
    appointmentId: string,
    businessId: string,
    customerId: string,
    newScheduledStartAt: Date,
  ) {
    const appointment = await this.getCustomerAppointmentById(
      appointmentId,
      businessId,
      customerId,
    );

    const reschedulableStatuses: AppointmentStatus[] = [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.NO_SHOW,
    ];

    if (!reschedulableStatuses.includes(appointment.status)) {
      throw new BadRequestException(
        `Agendamento com status ${appointment.status} não pode ser reagendado`,
      );
    }

    const isAvailable = await this.availabilityService.validateSlotAvailability(
      businessId,
      newScheduledStartAt,
      this.formatTime(newScheduledStartAt),
      appointment.vehicleType as any,
      appointment.serviceModeId,
    );

    if (!isAvailable) {
      throw new BadRequestException('Novo horário não está disponível');
    }

    const newScheduledEndAt = new Date(
      newScheduledStartAt.getTime() +
        appointment.snapshotDurationMinutes * 60000,
    );

    return this.prisma.$transaction(async (tx) => {
      const oldStatus = appointment.status;

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          scheduledStartAt: newScheduledStartAt,
          scheduledEndAt: newScheduledEndAt,
          status: AppointmentStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          oldStatus,
          newStatus: AppointmentStatus.CONFIRMED,
          reason: 'Reagendado pelo cliente',
        },
      });

      await this.notificationsService.createForUser({
        businessId,
        userId: appointment.customer.userId,
        appointmentId: appointment.id,
        type: NotificationType.APPOINTMENT_RESCHEDULED,
        title: 'Agendamento reagendado',
        message: `Seu agendamento #${appointment.bookingNumber} foi reagendado para ${this.formatNotificationDate(newScheduledStartAt)}.`,
      });

      await this.pushNotificationsService.sendToUser({
        userId: appointment.customer.userId,
        businessId,
        title: 'Agendamento reagendado',
        body: `Seu agendamento #${appointment.bookingNumber} foi reagendado para ${this.formatNotificationDate(newScheduledStartAt)}.`,
        url: '/notifications',
      });

      return updated;
    });
  }

  async startAppointment(
    appointmentId: string,
    businessId: string,
    adminId: string,
  ) {
    const appointment = await this.getAppointmentById(appointmentId, businessId);

    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException(
        'Apenas agendamentos confirmados podem iniciar',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.IN_PROGRESS,
          modifiedByAdminId: adminId,
          modifiedAt: new Date(),
        },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          oldStatus: appointment.status,
          newStatus: AppointmentStatus.IN_PROGRESS,
          reason: 'Iniciado pelo admin',
        },
      });

      await this.notificationsService.createForUser({
        businessId,
        userId: appointment.customer.userId,
        appointmentId: appointment.id,
        type: NotificationType.APPOINTMENT_STARTED,
        title: 'Atendimento iniciado',
        message: `Seu veículo entrou em atendimento no agendamento #${appointment.bookingNumber}.`,
      });

      await this.pushNotificationsService.sendToUser({
        userId: appointment.customer.userId,
        businessId,
        title: 'Atendimento iniciado',
        body: `Seu veículo entrou em atendimento no agendamento #${appointment.bookingNumber}.`,
        url: '/notifications',
      });

      return updated;
    });
  }

  async completeAppointment(
    appointmentId: string,
    businessId: string,
    adminId: string,
  ) {
    const appointment = await this.getAppointmentById(appointmentId, businessId);

    if (appointment.status !== AppointmentStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Apenas agendamentos em andamento podem ser concluídos',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.COMPLETED,
          completedAt: new Date(),
          modifiedByAdminId: adminId,
          modifiedAt: new Date(),
        },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          oldStatus: appointment.status,
          newStatus: AppointmentStatus.COMPLETED,
          reason: 'Finalizado pelo admin',
        },
      });

      return updated;
    });
  }

  async getCustomerAppointments(customerId: string, businessId: string) {
    return this.prisma.appointment.findMany({
      where: {
        customerId,
        businessId,
        deletedAt: null,
      },
      include: {
        serviceRule: { include: { serviceMode: true } },
        customer: true,
        statusHistory: { orderBy: { changedAt: 'desc' } },
      },
      orderBy: { scheduledStartAt: 'desc' },
    });
  }

  async getAppointmentsByDate(businessId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.prisma.appointment.findMany({
      where: {
        businessId,
        scheduledStartAt: { gte: startOfDay, lte: endOfDay },
        deletedAt: null,
      },
      include: {
        customer: true,
        serviceRule: { include: { serviceMode: true } },
      },
      orderBy: { scheduledStartAt: 'asc' },
    });
  }

  async getAppointmentById(appointmentId: string, businessId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: true,
        serviceRule: { include: { serviceMode: true } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
      },
    });

    if (!appointment || appointment.businessId !== businessId) {
      throw new NotFoundException('Agendamento não encontrado');
    }

    return appointment;
  }

  async getCustomerAppointmentById(
    appointmentId: string,
    businessId: string,
    customerId: string,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: true,
        serviceRule: { include: { serviceMode: true } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
      },
    });

    if (
      !appointment ||
      appointment.businessId !== businessId ||
      appointment.customerId !== customerId
    ) {
      throw new NotFoundException('Agendamento não encontrado');
    }

    return appointment;
  }

  private generateBookingNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${timestamp}${random}`;
  }

  private formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private serializeAppointment(
    appointment: Prisma.AppointmentGetPayload<{
      include: {
        customer: true;
        serviceRule: { include: { serviceMode: true } };
      };
    }>,
  ) {
    return {
      id: appointment.id,
      bookingNumber: appointment.bookingNumber,
      status: appointment.status,
      scheduledStartAt: appointment.scheduledStartAt,
      scheduledEndAt: appointment.scheduledEndAt,
      snapshotServiceModeName: appointment.snapshotServiceModeName,
      snapshotTotalPriceInCents: appointment.snapshotTotalPriceInCents,
      vehicleType: appointment.vehicleType,
      willSearchVehicle: appointment.willSearchVehicle,
      createdAt: appointment.createdAt,
    };
  }

  private async ensureBusinessCoordinates(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: { businessAddress: true },
    });

    if (!business?.businessAddress) {
      throw new BadRequestException('Endereço da empresa não configurado');
    }

    let latitude = business.businessAddress.latitude?.toNumber();
    let longitude = business.businessAddress.longitude?.toNumber();

    if (latitude == null || longitude == null) {
      const geo = await this.mapsService.geocodeAddress({
        streetAddress: business.businessAddress.streetAddress,
        number: business.businessAddress.number || '',
        neighborhood: business.businessAddress.neighborhood || '',
        city: business.businessAddress.city,
        state: business.businessAddress.state,
        zipCode: business.businessAddress.zipCode || '',
      });

      latitude = geo.latitude;
      longitude = geo.longitude;

      await this.prisma.businessAddress.update({
        where: { businessId },
        data: {
          latitude: new Prisma.Decimal(latitude),
          longitude: new Prisma.Decimal(longitude),
        },
      });
    }

    return {
      business,
      latitude,
      longitude,
    };
  }

  private calculateHaversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  private async resolveAddressCoordinatesFromManualAddress(data: {
    streetAddress: string;
    number?: string;
    neighborhood?: string;
    city: string;
    state: string;
    zipCode?: string;
    latitude?: number;
    longitude?: number;
  }) {
    if (
      typeof data.latitude === 'number' &&
      typeof data.longitude === 'number'
    ) {
      return {
        latitude: data.latitude,
        longitude: data.longitude,
      };
    }

    const geo = await this.mapsService.geocodeAddress({
      streetAddress: data.streetAddress,
      number: data.number || '',
      neighborhood: data.neighborhood || '',
      city: data.city,
      state: data.state,
      zipCode: data.zipCode || '',
    });

    return {
      latitude: geo.latitude,
      longitude: geo.longitude,
    };
  }

  async estimateSearchFee(
    businessId: string,
    customerId: string,
    dto: EstimateSearchFeeDto,
  ) {
    const {
      latitude: businessLat,
      longitude: businessLng,
    } = await this.ensureBusinessCoordinates(businessId);

    const serviceRule = await this.prisma.serviceModeRule.findFirst({
      where: {
        serviceMode: { id: dto.serviceModeId, businessId },
        vehicleType: { kind: dto.vehicleType },
      },
    });

    if (!serviceRule) {
      throw new BadRequestException(
        'Modalidade não disponível para este tipo de veículo',
      );
    }

    if (!dto.willSearchVehicle) {
      return {
        distanceKm: 0,
        searchFeeInCents: 0,
        basePriceInCents: serviceRule.basePriceInCents,
        totalPriceInCents: serviceRule.basePriceInCents,
      };
    }

    if (!dto.searchType) {
      throw new BadRequestException('searchType é obrigatório');
    }

    let customerLat: number | null = null;
    let customerLng: number | null = null;

    if (dto.searchType === 'CURRENT_LOCATION') {
      if (
        typeof dto.latitude !== 'number' ||
        typeof dto.longitude !== 'number'
      ) {
        throw new BadRequestException(
          'Latitude e longitude são obrigatórios para localização atual',
        );
      }

      customerLat = dto.latitude;
      customerLng = dto.longitude;
    }

    if (dto.searchType === 'MANUAL_ADDRESS') {
      if (dto.serviceAddressId) {
        const savedAddress = await this.prisma.address.findUnique({
          where: { id: dto.serviceAddressId },
        });

        if (
          !savedAddress ||
          savedAddress.businessId !== businessId ||
          savedAddress.customerId !== customerId
        ) {
          throw new BadRequestException(
            'Endereço inválido, não encontrado ou não autorizado',
          );
        }

        if (savedAddress.latitude && savedAddress.longitude) {
          customerLat = savedAddress.latitude.toNumber();
          customerLng = savedAddress.longitude.toNumber();
        } else {
          const geo = await this.mapsService.geocodeAddress({
            streetAddress: savedAddress.streetAddress,
            number: savedAddress.number || '',
            neighborhood: savedAddress.neighborhood || '',
            city: savedAddress.city,
            state: savedAddress.state,
            zipCode: savedAddress.zipCode || '',
          });

          customerLat = geo.latitude;
          customerLng = geo.longitude;

          await this.prisma.address.update({
            where: { id: savedAddress.id },
            data: {
              latitude: new Prisma.Decimal(customerLat),
              longitude: new Prisma.Decimal(customerLng),
            },
          });
        }
      } else {
        if (!dto.streetAddress || !dto.city || !dto.state) {
          throw new BadRequestException(
            'Rua, cidade e estado são obrigatórios para endereço manual',
          );
        }

        const geo = await this.resolveAddressCoordinatesFromManualAddress({
          streetAddress: dto.streetAddress,
          number: dto.number,
          neighborhood: dto.neighborhood,
          city: dto.city,
          state: dto.state,
          zipCode: dto.zipCode,
          latitude: dto.latitude,
          longitude: dto.longitude,
        });

        customerLat = geo.latitude;
        customerLng = geo.longitude;
      }
    }

    if (customerLat == null || customerLng == null) {
      throw new BadRequestException(
        'Não foi possível determinar a localização do cliente',
      );
    }

    const distanceKm = this.calculateHaversineKm(
      businessLat,
      businessLng,
      customerLat,
      customerLng,
    );

    const settings = await this.prisma.businessSettings.findUnique({
      where: { businessId },
    });

    if (!settings) {
      throw new BadRequestException('Configurações de negócio não encontradas');
    }

    const limitKm = settings.searchFeeLimitKm.toNumber();
    const searchFeeInCents =
      distanceKm <= 0
        ? 0
        : distanceKm <= limitKm
          ? settings.searchFeeUpTo5km
          : settings.searchFeeOver5km;

    return {
      distanceKm: Number(distanceKm.toFixed(2)),
      searchFeeInCents,
      basePriceInCents: serviceRule.basePriceInCents,
      totalPriceInCents: serviceRule.basePriceInCents + searchFeeInCents,
    };
  }

  private formatNotificationDate(date: Date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} às ${hours}:${minutes}`;
  }
}