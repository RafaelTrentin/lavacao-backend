import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, Prisma } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async createForUser(data: {
    businessId: string;
    userId: string;
    appointmentId?: string;
    type: NotificationType;
    title: string;
    message: string;
  }, db: Prisma.TransactionClient = this.prisma) {
    const recipient = await db.user.findFirst({ where: { id: data.userId, businessId: data.businessId }, select: { id: true } });
    if (!recipient) throw new NotFoundException('Destinatário não encontrado');
    return db.notification.create({
      data: {
        businessId: data.businessId, userId: data.userId, appointmentId: data.appointmentId,
        type: data.type, title: data.title, message: data.message,
      },
    });
  }

  async getMyNotifications(userId: string, businessId: string) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        businessId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getUnreadCount(userId: string, businessId: string) {
    const count = await this.prisma.notification.count({
      where: {
        userId,
        businessId,
        isRead: false,
      },
    });

    return { count };
  }

  async markAsRead(notificationId: string, userId: string, businessId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
        businessId,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notificação não encontrada');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string, businessId: string) {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        businessId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { success: true };
  }
}
