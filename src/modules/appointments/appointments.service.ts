import { businessTimezone, civilDate, dayBounds, localParts, notificationDate, utcInstant } from '../../common/business-time';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  AppointmentStatus,
  SearchType,
  NotificationType,
  Notification,
  Appointment,
} from '@prisma/client';
import { withScheduleTransaction } from './schedule-transaction';
import { searchFeePolicy } from './search-fee-policy';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { MapsService } from '../maps/maps.service';
import { EstimateSearchFeeDto } from './dto/estimate-search-fee.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);
  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
    private mapsService: MapsService,
    private notificationsService: NotificationsService,
    private pushNotificationsService: PushNotificationsService,
  ) {}

  private async recordAdminNotifications(tx: Prisma.TransactionClient, appointment: Appointment): Promise<Notification[]> {
    const admins = await tx.user.findMany({
      where: { businessId: appointment.businessId, role: 'ADMIN', isActive: true, deletedAt: null },
      select: { id: true },
    });
    return Promise.all(admins.map((admin) => this.notificationsService.createForUser({
      businessId: appointment.businessId, userId: admin.id, appointmentId: appointment.id,
      type: NotificationType.GENERAL, title: 'Novo agendamento recebido',
      message: `Um cliente realizou o agendamento #${appointment.bookingNumber}.`,
    }, tx)));
  }

  /** Best-effort dispatch, only after the transaction promise has committed.
   * No queue, no automatic retry, and no provider latency on the HTTP response.
   * Internal Notification rows remain available even if this process stops here.
   */
  private dispatchAfterCommit(events: Notification[], snapshot: Appointment): void {
    for (const event of events) {
      void this.dispatchCommittedEvent(event, snapshot).catch(() => {
        // Provider errors may contain tokens/endpoints. Log only our event ID.
        this.logger.warn(`Falha ao entregar push da notificacao ${event.id}`);
      });
    }
  }

  private async dispatchCommittedEvent(event: Notification, snapshot: Appointment): Promise<void> {
    const current = await this.prisma.appointment.findFirst({
      where: {
        id: snapshot.id, businessId: event.businessId, deletedAt: null,
        status: snapshot.status, scheduledStartAt: snapshot.scheduledStartAt,
        confirmedAt: snapshot.confirmedAt, modifiedAt: snapshot.modifiedAt,
        cancelledAt: snapshot.cancelledAt, completedAt: snapshot.completedAt,
      }, select: { id: true },
    });
    // A later committed transition may already have superseded this message.
    if (!current) return;
    await this.pushNotificationsService.sendToUser({
      businessId: event.businessId, userId: event.userId, title: event.title,
      body: event.message, url: '/notifications',
    });
  }

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

    const scheduledDate = utcInstant(scheduledStartAt);
    if (isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Data/hora inválida');
    }

    const serviceMode = await this.prisma.serviceMode.findUnique({
      where: { id: serviceModeId },
    });

    if (
      !serviceMode ||
      serviceMode.businessId !== businessId ||
      serviceMode.deletedAt ||
      !serviceMode.isActive
    ) {
      throw new BadRequestException('Modalidade inválida ou desativada');
    }

    const serviceRule = await this.prisma.serviceModeRule.findFirst({
      where: {
        serviceMode: { id: serviceModeId, businessId, isActive: true, deletedAt: null },
        vehicleType: { kind: vehicleType, businessId, deletedAt: null },
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

  if (![SearchType.CURRENT_LOCATION, SearchType.MANUAL_ADDRESS].includes(searchType as SearchType)) {
    throw new BadRequestException('Tipo de busca inválido');
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
    // No automatic charge, even if an address has coordinates. Negotiated offline.
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
            savedAddress.deletedAt ||
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
          this.validateManualPickupAddress({ streetAddress, city, state });
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

    const durationMinutes = serviceRule.durationMinutes;
    const scheduledEndAt = new Date(
      scheduledDate.getTime() + durationMinutes * 60000,
    );

    const basePrice = serviceRule.basePriceInCents;
    const totalPriceInCents = basePrice + searchFeeInCents;

    const bookingNumber = this.generateBookingNumber();

    const { appointment, events } = await withScheduleTransaction(this.prisma, businessId,
      async (tx) => {
        const isAvailable = await this.availabilityService.validateSlotAvailability(
          businessId,
          scheduledDate,
          '',
          vehicleType,
          serviceModeId,
          { tx, durationMinutes, exactStart: true },
        );

        if (!isAvailable) {
          throw new BadRequestException(
            'Horário não está mais disponível. Por favor, escolha outro.',
          );
        }


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
            snapshotDistanceKm: willSearchVehicle && searchType === SearchType.CURRENT_LOCATION
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

        const events = await this.recordAdminNotifications(tx, newAppointment);
        return { appointment: newAppointment, events };
      },
    );

    this.dispatchAfterCommit(events, appointment);

    return this.serializeAppointment(appointment);
  }

  async cancelAppointment(
    appointmentId: string,
    businessId: string,
    userId: string,
    userRole: string,
    reason?: string,
  ) {
    const { updated, events } = await withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const appointment = await this.getAppointmentById(appointmentId, businessId, tx);

      if (userRole === 'CUSTOMER') {
        const customer = await tx.customerProfile.findUnique({
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

      const oldStatus = appointment.status;

      const updated = await tx.appointment.update({
        where: { id: appointmentId, businessId, deletedAt: null },
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

      const event = await this.notificationsService.createForUser({
        businessId,
        userId: appointment.customer.userId,
        appointmentId: appointment.id,
        type: NotificationType.APPOINTMENT_CANCELLED,
        title: 'Agendamento cancelado',
        message: `Seu agendamento #${appointment.bookingNumber} foi cancelado.`,
      }, tx);
      return { updated, events: [event] };
    });

    this.dispatchAfterCommit(events, updated);
    return { ...updated, ...searchFeePolicy(updated) };
  }

  async rescheduleAppointment(
    appointmentId: string,
    businessId: string,
    newScheduledStartAt: Date,
    adminId?: string,
  ) {
    const { updated, events } = await withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const appointment = await this.getAppointmentById(appointmentId, businessId, tx);

      const reschedulableStatuses: AppointmentStatus[] = [
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.NO_SHOW,
      ];

      if (!reschedulableStatuses.includes(appointment.status)) {
        throw new BadRequestException(
          `Agendamento com status ${appointment.status} não pode ser reagendado`,
        );
      }

      if (appointment.status === AppointmentStatus.CONFIRMED &&
          appointment.scheduledStartAt.getTime() === newScheduledStartAt.getTime()) {
        const updated = await tx.appointment.findUnique({ where: { id: appointmentId, businessId, deletedAt: null } });
        return { updated, events: [] as Notification[] };
      }

      const isAvailable = await this.availabilityService.validateSlotAvailability(
        businessId,
        newScheduledStartAt,
        '',
        appointment.vehicleType as any,
        appointment.serviceModeId,
        { tx, durationMinutes: appointment.snapshotDurationMinutes, excludeAppointmentId: appointment.id, exactStart: true },
      );

      if (!isAvailable) {
        throw new BadRequestException('Novo horário não está disponível');
      }

      const newScheduledEndAt = new Date(
        newScheduledStartAt.getTime() +
          appointment.snapshotDurationMinutes * 60000,
      );

      const oldStatus = appointment.status;

      const updated = await tx.appointment.update({
        where: { id: appointmentId, businessId, deletedAt: null },
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

      const business = await tx.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
      const timezone = businessTimezone(business?.timezone);
      const event = await this.notificationsService.createForUser({
        businessId,
        userId: appointment.customer.userId,
        appointmentId: appointment.id,
        type: NotificationType.APPOINTMENT_RESCHEDULED,
        title: 'Agendamento reagendado',
        message: `Seu agendamento #${appointment.bookingNumber} foi reagendado para ${notificationDate(newScheduledStartAt, timezone)}.`,
      }, tx);
      return { updated, events: [event] };
    });

    this.dispatchAfterCommit(events, updated);
    return { ...updated, ...searchFeePolicy(updated) };
  }

  async rescheduleCustomerAppointment(
    appointmentId: string,
    businessId: string,
    customerId: string,
    newScheduledStartAt: Date,
  ) {
    const { updated, events } = await withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const appointment = await this.getCustomerAppointmentById(
        appointmentId,
        businessId,
        customerId,
        tx,
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

      if (appointment.status === AppointmentStatus.CONFIRMED &&
          appointment.scheduledStartAt.getTime() === newScheduledStartAt.getTime()) {
        const updated = await tx.appointment.findUnique({ where: { id: appointmentId, businessId, deletedAt: null } });
        return { updated, events: [] as Notification[] };
      }

      const isAvailable = await this.availabilityService.validateSlotAvailability(
        businessId,
        newScheduledStartAt,
        '',
        appointment.vehicleType as any,
        appointment.serviceModeId,
        { tx, durationMinutes: appointment.snapshotDurationMinutes, excludeAppointmentId: appointment.id, exactStart: true },
      );

      if (!isAvailable) {
        throw new BadRequestException('Novo horário não está disponível');
      }

      const newScheduledEndAt = new Date(
        newScheduledStartAt.getTime() +
          appointment.snapshotDurationMinutes * 60000,
      );

      const oldStatus = appointment.status;

      const updated = await tx.appointment.update({
        where: { id: appointmentId, businessId, deletedAt: null },
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

      const business = await tx.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
      const timezone = businessTimezone(business?.timezone);
      const event = await this.notificationsService.createForUser({
        businessId,
        userId: appointment.customer.userId,
        appointmentId: appointment.id,
        type: NotificationType.APPOINTMENT_RESCHEDULED,
        title: 'Agendamento reagendado',
        message: `Seu agendamento #${appointment.bookingNumber} foi reagendado para ${notificationDate(newScheduledStartAt, timezone)}.`,
      }, tx);
      return { updated, events: [event] };
    });

    this.dispatchAfterCommit(events, updated);
    return { ...updated, ...searchFeePolicy(updated) };
  }

  async startAppointment(
    appointmentId: string,
    businessId: string,
    adminId: string,
  ) {
    const { updated, events } = await withScheduleTransaction(this.prisma, businessId, async (tx) => {
      const appointment = await this.getAppointmentById(appointmentId, businessId, tx);

      if (appointment.status !== AppointmentStatus.CONFIRMED) {
        throw new BadRequestException(
          'Apenas agendamentos confirmados podem iniciar',
        );
      }


      const updated = await tx.appointment.update({
        where: { id: appointmentId, businessId, deletedAt: null },
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

      const event = await this.notificationsService.createForUser({
        businessId,
        userId: appointment.customer.userId,
        appointmentId: appointment.id,
        type: NotificationType.APPOINTMENT_STARTED,
        title: 'Atendimento iniciado',
        message: `Seu veículo entrou em atendimento no agendamento #${appointment.bookingNumber}.`,
      }, tx);
      return { updated, events: [event] };
    });

    this.dispatchAfterCommit(events, updated);
    return { ...updated, ...searchFeePolicy(updated) };
  }

async completeAppointment(
  appointmentId: string,
  businessId: string,
  adminId: string,
) {
  const { updated, events } = await withScheduleTransaction(this.prisma, businessId, async (tx) => {
    const appointment = await this.getAppointmentById(
      appointmentId,
      businessId,
      tx,
    );

    if (appointment.status !== AppointmentStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Apenas agendamentos em andamento podem ser concluídos',
      );
    }


    const result = await tx.appointment.update({
      where: { id: appointmentId, businessId, deletedAt: null },
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

  const title = 'Seu veículo está pronto!';
  const message =
    `O atendimento do seu agendamento #${appointment.bookingNumber} ` +
    'foi concluído. Obrigado por escolher nossa lavação!';

    const event = await this.notificationsService.createForUser({
      businessId,
      userId: appointment.customer.userId,
      appointmentId: appointment.id,
      type: NotificationType.GENERAL,
      title,
      message,
    }, tx);
    return { updated: result, events: [event] };
  });

  this.dispatchAfterCommit(events, updated);
  return { ...updated, ...searchFeePolicy(updated) };
}

  async getCustomerAppointments(customerId: string, businessId: string) {
    const appointments = await this.prisma.appointment.findMany({
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
    return appointments.map((appointment) => ({ ...appointment, ...searchFeePolicy(appointment) }));
  }

  async getAppointmentsByDate(businessId: string, date: string | Date) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
    if (!business) throw new NotFoundException('Empresa nao encontrada');
    const zone = businessTimezone(business.timezone);
    const dateKey = typeof date === 'string' ? civilDate(date) : localParts(date, zone).date;
    const { start: startOfDay, end: endOfDay } = dayBounds(dateKey, zone);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        scheduledStartAt: { gte: startOfDay, lt: endOfDay },
        deletedAt: null,
      },
      include: {
        customer: true,
        serviceRule: { include: { serviceMode: true } },
      },
      orderBy: { scheduledStartAt: 'asc' },
    });
    return appointments.map((appointment) => ({ ...appointment, ...searchFeePolicy(appointment) }));
  }

  async getAppointmentById(appointmentId: string, businessId: string, db: Prisma.TransactionClient = this.prisma) {
    const appointment = await db.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: true,
        serviceRule: { include: { serviceMode: true } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
      },
    });

    if (!appointment || appointment.businessId !== businessId || appointment.deletedAt) {
      throw new NotFoundException('Agendamento não encontrado');
    }

    return { ...appointment, ...searchFeePolicy(appointment) };
  }

  async getCustomerAppointmentById(
    appointmentId: string,
    businessId: string,
    customerId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const appointment = await db.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: true,
        serviceRule: { include: { serviceMode: true } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
      },
    });

    if (
      !appointment ||
      appointment.deletedAt ||
      appointment.businessId !== businessId ||
      appointment.customerId !== customerId
    ) {
      throw new NotFoundException('Agendamento não encontrado');
    }

    return { ...appointment, ...searchFeePolicy(appointment) };
  }

  private generateBookingNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${timestamp}${random}`;
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
      ...searchFeePolicy(appointment),
      id: appointment.id,
      bookingNumber: appointment.bookingNumber,
      status: appointment.status,
      scheduledStartAt: appointment.scheduledStartAt,
      scheduledEndAt: appointment.scheduledEndAt,
      snapshotServiceModeName: appointment.snapshotServiceModeName,
      snapshotTotalPriceInCents: appointment.snapshotTotalPriceInCents,
      vehicleType: appointment.vehicleType,
      willSearchVehicle: appointment.willSearchVehicle,
      searchType: appointment.searchType,
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

  async estimateSearchFee(
    businessId: string,
    customerId: string,
    dto: EstimateSearchFeeDto,
  ) {
    const serviceRule = await this.prisma.serviceModeRule.findFirst({
      where: {
        serviceMode: { id: dto.serviceModeId, businessId, isActive: true, deletedAt: null },
        vehicleType: { kind: dto.vehicleType, businessId, deletedAt: null },
      },
    });

    if (!serviceRule) {
      throw new BadRequestException(
        'Modalidade não disponível para este tipo de veículo',
      );
    }

    if (!dto.willSearchVehicle) {
      return {
        ...searchFeePolicy(dto),
        distanceKm: 0,
        searchFeeInCents: 0,
        basePriceInCents: serviceRule.basePriceInCents,
        totalPriceInCents: serviceRule.basePriceInCents,
      };
    }

    if (!dto.searchType) {
      throw new BadRequestException('searchType é obrigatório');
    }

    if (dto.searchType === 'MANUAL_ADDRESS') {
      if (dto.serviceAddressId) {
        const address = await this.prisma.address.findUnique({ where: { id: dto.serviceAddressId } });
        if (!address || address.deletedAt || address.businessId !== businessId || address.customerId !== customerId) {
          throw new BadRequestException('Endereço inválido, não encontrado ou não autorizado');
        }
      } else {
        this.validateManualPickupAddress(dto);
      }
      return {
        ...searchFeePolicy(dto), distanceKm: null, searchFeeInCents: 0,
        basePriceInCents: serviceRule.basePriceInCents, totalPriceInCents: serviceRule.basePriceInCents,
      };
    }
    if (dto.searchType !== 'CURRENT_LOCATION') throw new BadRequestException('Tipo de busca inválido');
    this.validatePickupCoordinates(dto.latitude, dto.longitude);
    const { latitude: businessLat, longitude: businessLng } = await this.ensureBusinessCoordinates(businessId);
    this.validatePickupCoordinates(businessLat, businessLng);

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
      ...searchFeePolicy(dto),
      distanceKm: Number(distanceKm.toFixed(2)),
      searchFeeInCents,
      basePriceInCents: serviceRule.basePriceInCents,
      totalPriceInCents: serviceRule.basePriceInCents + searchFeeInCents,
    };
  }

  private validateManualPickupAddress(data: { streetAddress?: string; city?: string; state?: string }) {
    if (![data.streetAddress, data.city, data.state].every((value) => typeof value === 'string' && value.trim())) {
      throw new BadRequestException('Rua, cidade e estado são obrigatórios para endereço manual');
    }
  }

  private validatePickupCoordinates(latitude: unknown, longitude: unknown) {
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new BadRequestException('Latitude e longitude válidas são obrigatórias para localização atual');
    }
  }

}
