import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentStatus } from 'src/common/enums';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDaySummary(businessId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // HOJE
    const todayAppointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        scheduledStartAt: { gte: startOfDay, lte: endOfDay },
        deletedAt: null,
      },
      include: {
        customer: true,
        serviceRule: { include: { serviceMode: true } },
      },
    });

    // SEMANA
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const weekAppointments = await this.prisma.appointment.count({
      where: {
        businessId,
        scheduledStartAt: { gte: startOfWeek, lte: endOfWeek },
        deletedAt: null,
      },
    });

    // MÊS
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const monthAppointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        scheduledStartAt: { gte: startOfMonth, lte: endOfMonth },
        status: {
          in: [
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.COMPLETED,
          ],
        },
        deletedAt: null,
      },
    });

    const monthRevenue =
      monthAppointments.reduce(
        (sum, a) => sum + a.snapshotTotalPriceInCents,
        0,
      ) / 100;

    // CLIENTES
    const totalClients = await this.prisma.customerProfile.count({
      where: { businessId },
    });

    // TAXA DE CANCELAMENTO (HOJE)
    const cancelledToday = todayAppointments.filter(
      (a) => a.status === AppointmentStatus.CANCELLED,
    ).length;

    const cancellationRate =
      todayAppointments.length > 0
        ? Number(
            ((cancelledToday / todayAppointments.length) * 100).toFixed(2),
          )
        : 0;

    // TICKET MÉDIO (HOJE)
    const validForRevenueToday = todayAppointments.filter(
      (a) => a.status !== AppointmentStatus.CANCELLED,
    );

    const totalRevenueToday =
      validForRevenueToday.reduce(
        (sum, a) => sum + a.snapshotTotalPriceInCents,
        0,
      ) / 100;

    const averageTicket =
      validForRevenueToday.length > 0
        ? Number((totalRevenueToday / validForRevenueToday.length).toFixed(2))
        : 0;

    // FATURAMENTO POR DIA - ÚLTIMOS 7 DIAS
    const dailyRevenue: Array<{ date: string; revenue: number }> = [];

    for (let i = 6; i >= 0; i--) {
      const day = new Date(date);
      day.setDate(date.getDate() - i);

      const start = new Date(day);
      start.setHours(0, 0, 0, 0);

      const end = new Date(day);
      end.setHours(23, 59, 59, 999);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          businessId,
          scheduledStartAt: { gte: start, lte: end },
          status: {
            in: [
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.COMPLETED,
            ],
          },
          deletedAt: null,
        },
      });

      const revenue =
        appointments.reduce(
          (sum, a) => sum + a.snapshotTotalPriceInCents,
          0,
        ) / 100;

      dailyRevenue.push({
        date: start.toISOString(),
        revenue,
      });
    }

    // RANKING DE SERVIÇOS (HOJE)
    const serviceMap: Record<string, { count: number }> = {};

    todayAppointments.forEach((a) => {
      const name = a.snapshotServiceModeName || 'Serviço';

      if (!serviceMap[name]) {
        serviceMap[name] = { count: 0 };
      }

      serviceMap[name].count += 1;
    });

    const topServices = Object.entries(serviceMap)
      .map(([name, data]) => ({
        name,
        count: data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // RANKING DE CLIENTES (MÊS)
const monthlyAppointments = await this.prisma.appointment.findMany({
  where: {
    businessId,
    scheduledStartAt: { gte: startOfMonth, lte: endOfMonth },
    deletedAt: null,
  },
  include: {
    customer: true,
  },
});

    // RANKING DE CLIENTES (MÊS)
    const customerMap: Record<string, { name: string; count: number }> = {};
      monthlyAppointments.forEach((a) => {
        if (!customerMap[a.customerId]) {
            customerMap[a.customerId] = {
              name: a.customer?.name || 'Cliente',
              count: 0,
              };
          }
          customerMap[a.customerId].count += 1;
      });

const topCustomers = Object.values(customerMap)
  .sort((a, b) => b.count - a.count)
  .slice(0, 5);

    // AGENDAMENTOS RECENTES
    const recentAppointmentsRaw = await this.prisma.appointment.findMany({
      where: {
        businessId,
        deletedAt: null,
      },
      include: {
        customer: true,
        serviceRule: { include: { serviceMode: true } },
      },
      orderBy: {
        scheduledStartAt: 'desc',
      },
      take: 5,
    });

    const recentAppointments = recentAppointmentsRaw.map((a) => ({
      id: a.id,
      status: a.status,
      vehicleType: a.vehicleType,
      client: {
        name: a.customer?.name || 'Cliente',
      },
      serviceMode: {
        name:
          a.snapshotServiceModeName ||
          a.serviceRule?.serviceMode?.name ||
          'Serviço',
      },
      time: a.scheduledStartAt.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      date: a.scheduledStartAt.toISOString(),
    }));

    return {
      todayAppointments: todayAppointments.length,
      weekAppointments,
      monthRevenue,
      totalClients,
      recentAppointments,
      cancellationRate,
      averageTicket,
      dailyRevenue,
      topServices,
      topCustomers,
    };
  }

  async getRevenueByPeriod(
    businessId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        scheduledStartAt: { gte: startDate, lte: endDate },
        status: {
          in: [AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED],
        },
        deletedAt: null,
      },
    });

    const totalRevenue = appointments.reduce(
      (sum, a) => sum + a.snapshotTotalPriceInCents,
      0,
    );

    const averageValue =
      appointments.length > 0
        ? Math.round(totalRevenue / appointments.length)
        : 0;

    return {
      startDate,
      endDate,
      totalAppointments: appointments.length,
      totalRevenueInCents: totalRevenue,
      averageValueInCents: averageValue,
      daysInPeriod: Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
    };
  }

  async getDistributionByServiceMode(
    businessId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        scheduledStartAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
    });

    const distribution = appointments.reduce(
      (acc, a) => {
        const modeName = a.snapshotServiceModeName || 'Serviço';
        if (!acc[modeName]) {
          acc[modeName] = { count: 0, revenue: 0, cancelled: 0 };
        }
        acc[modeName].count += 1;
        if (a.status !== AppointmentStatus.CANCELLED) {
          acc[modeName].revenue += a.snapshotTotalPriceInCents;
        } else {
          acc[modeName].cancelled += 1;
        }
        return acc;
      },
      {} as Record<
        string,
        { count: number; revenue: number; cancelled: number }
      >,
    );

    return Object.entries(distribution).map(([name, data]) => ({
      serviceMode: name,
      totalAppointments: data.count,
      completedAppointments: data.count - data.cancelled,
      cancelledAppointments: data.cancelled,
      totalRevenueInCents: data.revenue,
    }));
  }

  async getVehicleDistribution(
    businessId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        scheduledStartAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
    });

    const cars = appointments.filter((a) => a.vehicleType === 'CAR');
    const motorcycles = appointments.filter(
      (a) => a.vehicleType === 'MOTORCYCLE',
    );

    const carRevenue = cars
      .filter((a) => a.status !== AppointmentStatus.CANCELLED)
      .reduce((sum, a) => sum + a.snapshotTotalPriceInCents, 0);

    const motorcycleRevenue = motorcycles
      .filter((a) => a.status !== AppointmentStatus.CANCELLED)
      .reduce((sum, a) => sum + a.snapshotTotalPriceInCents, 0);

    return {
      cars: {
        count: cars.length,
        revenue: carRevenue,
      },
      motorcycles: {
        count: motorcycles.length,
        revenue: motorcycleRevenue,
      },
    };
  }

  async getCancelledAnalysis(
    businessId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const cancelled = await this.prisma.appointment.findMany({
      where: {
        businessId,
        status: AppointmentStatus.CANCELLED,
        cancelledAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
    });

    const totalLostRevenue = cancelled.reduce(
      (sum, a) => sum + a.snapshotTotalPriceInCents,
      0,
    );

    const total = await this.getTotalAppointmentsInPeriod(
      businessId,
      startDate,
      endDate,
    );

    return {
      cancelledCount: cancelled.length,
      totalLostRevenueInCents: totalLostRevenue,
      cancellationRate:
        total > 0 ? ((cancelled.length / total) * 100).toFixed(2) : '0',
    };
  }

  async getTopCustomers(businessId: string, startDate: Date, endDate: Date) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        scheduledStartAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
      include: { customer: true },
    });

    const customerMap = appointments.reduce(
      (acc, a) => {
        const key = a.customerId;
        if (!acc[key]) {
          acc[key] = {
            customerId: a.customerId,
            customerName: a.customer?.name || 'Cliente',
            appointmentCount: 0,
            totalSpent: 0,
          };
        }
        acc[key].appointmentCount += 1;
        if (a.status !== AppointmentStatus.CANCELLED) {
          acc[key].totalSpent += a.snapshotTotalPriceInCents;
        }
        return acc;
      },
      {} as Record<
        string,
        {
          customerId: string;
          customerName: string;
          appointmentCount: number;
          totalSpent: number;
        }
      >,
    );

    return Object.values(customerMap)
      .sort((a, b) => b.appointmentCount - a.appointmentCount)
      .slice(0, 10);
  }

  private async getTotalAppointmentsInPeriod(
    businessId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const count = await this.prisma.appointment.count({
      where: {
        businessId,
        scheduledStartAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
    });
    return count;
  }

  async getTopCustomersByPeriod(
  businessId: string,
  period: 'WEEK' | 'MONTH',
) {
  const now = new Date();

  let startDate: Date;
  let endDate: Date;

  if (period === 'WEEK') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - now.getDay());
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);
  }

  const appointments = await this.prisma.appointment.findMany({
    where: {
      businessId,
      scheduledStartAt: { gte: startDate, lte: endDate },
      deletedAt: null,
    },
    include: {
      customer: true,
    },
  });

  const customerMap: Record<string, { name: string; count: number }> = {};

  appointments.forEach((a) => {
    if (!customerMap[a.customerId]) {
      customerMap[a.customerId] = {
        name: a.customer?.name || 'Cliente',
        count: 0,
      };
    }

    customerMap[a.customerId].count += 1;
  });

  return Object.values(customerMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

}