import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(private prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:rafaelctrentin@gmail.com';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configuradas. Push ficará inativo.',
      );
    }
  }

  async saveSubscription(params: {
    businessId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }) {
    return this.prisma.pushSubscription.upsert({
      where: {
        endpoint: params.endpoint,
      },
      update: {
        p256dh: params.p256dh,
        auth: params.auth,
        userId: params.userId,
        businessId: params.businessId,
      },
      create: {
        businessId: params.businessId,
        userId: params.userId,
        endpoint: params.endpoint,
        p256dh: params.p256dh,
        auth: params.auth,
      },
    });
  }

  async removeSubscription(endpoint: string, userId: string, businessId: string) {
    return this.prisma.pushSubscription.deleteMany({
      where: {
        endpoint,
        userId,
        businessId,
      },
    });
  }

  async getPublicKey() {
    return { publicKey: process.env.VAPID_PUBLIC_KEY || '' };
  }

  async sendToUser(params: {
    userId: string;
    businessId: string;
    title: string;
    body: string;
    url?: string;
  }) {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: {
        userId: params.userId,
        businessId: params.businessId,
      },
    });

    if (!subscriptions.length) return;

    const payload = JSON.stringify({
      title: params.title,
      body: params.body,
      url: params.url || '/notifications',
    });

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload,
          );
        } catch (error: any) {
          const statusCode = error?.statusCode;

          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.deleteMany({
              where: { endpoint: sub.endpoint },
            });
          }

          this.logger.warn(
            `Falha ao enviar push para endpoint ${sub.endpoint}: ${error?.message || error}`,
          );
        }
      }),
    );
  }
}