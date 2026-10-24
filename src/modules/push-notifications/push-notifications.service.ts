import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseMessagingService } from './firebase-messaging.service';
import { createHash } from 'node:crypto';
import * as webpush from 'web-push';

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseMessaging: FirebaseMessagingService,
  ) {
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

    const business = await this.prisma.business.findUnique({
      where: { id: params.businessId },
      select: { slug: true },
    });

    const defaultUrl = business?.slug
      ? `/empresa/${business.slug}/my-appointments`
      : '/my-appointments';

    const payload = JSON.stringify({
      title: params.title,
      body: params.body,
      url: params.url || defaultUrl,
    });

    if (subscriptions.length > 0) {
      this.logger.log(
        `Web Push: iniciando envio para ${subscriptions.length} inscrição(ões) da empresa ${params.businessId}.`,
      );
    }

    const webPushResults = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
          return true;
        } catch (error: any) {
          const statusCode = error?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.deleteMany({
              where: {
                endpoint: sub.endpoint,
                userId: params.userId,
                businessId: params.businessId,
              },
            });
          }
          // Não registrar o endpoint: ele é uma URL sensível.
          this.logger.warn(
            `Web Push não entregue: HTTP ${statusCode ?? 'sem status'}; código ${error?.code || 'indisponível'}.`,
          );
          return false;
        }
      }),
    );

    if (subscriptions.length > 0) {
      const succeeded = webPushResults.filter(
        (result) => result.status === 'fulfilled' && result.value === true,
      ).length;
      this.logger.log(
        `Web Push: ${succeeded}/${subscriptions.length} envio(s) aceito(s) pelo serviço de push.`,
      );
    }
    // Notificações nativas Android; integração iOS FCM ainda pendente.
    if (!this.firebaseMessaging.isAvailable()) {
      return;
    }

    const pushActivityLimit = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    );

    const devices = await this.prisma.pushDevice.findMany({
      where: {
        userId: params.userId,
        businessId: params.businessId,
        isActive: true,
        updatedAt: { gte: pushActivityLimit },
      },
      select: { id: true, token: true },
    });

    await Promise.allSettled(
      devices.map(async (device) => {
        try {
          await this.firebaseMessaging.sendToDevice({
            token: device.token,
            title: params.title,
            body: params.body,
            url: params.url || defaultUrl,
          });
        } catch (error: any) {
          const code = error?.code;

          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            await this.prisma.pushDevice.updateMany({
              where: { id: device.id, token: device.token },
              data: { isActive: false },
            });
            this.logger.warn(
              `Token FCM inválido; dispositivo ${device.id} desativado.`,
            );
            return;
          }

          this.logger.warn(
            `Falha no envio FCM para dispositivo ${device.id}: ${
              code || error?.message || 'Erro desconhecido'
            }`,
          );
        }
      }),
    );
  }

  async getDeviceStatus(params: {
    businessId: string;
    userId: string;
    token: string;
  }) {
    const device = await this.prisma.pushDevice.findFirst({
      where: {
        businessId: params.businessId,
        userId: params.userId,
        token: params.token,
        isActive: true,
      },
      select: { platform: true },
    });

    return {
      registered: Boolean(device),
      platform: device?.platform ?? null,
    };
  }

  async registerDevice(params: {
    businessId: string;
    userId: string;
    platform: 'ANDROID' | 'IOS';
    token: string;
    installationId?: string;
    revocationKey?: string;
  }) {
    const existing = await this.prisma.pushDevice.findUnique({
      where: { token: params.token },
    });

    if (
      existing &&
      (existing.userId !== params.userId ||
        existing.businessId !== params.businessId)
    ) {
      throw new ConflictException(
        'Dispositivo já associado a outra conta. Desative as notificações na conta anterior antes de ativá-las novamente.',
      );
    }

    const revocationKeyHash = params.revocationKey
      ? createHash('sha256').update(params.revocationKey).digest('hex')
      : undefined;

    const device = await this.prisma.pushDevice.upsert({
      where: { token: params.token },
      create: {
        businessId: params.businessId,
        userId: params.userId,
        platform: params.platform,
        token: params.token,
        installationId: params.installationId ?? null,
        revocationKeyHash: revocationKeyHash ?? null,
        isActive: true,
      },
      update: {
        platform: params.platform,
        isActive: true,
        ...(params.installationId !== undefined
          ? { installationId: params.installationId }
          : {}),
        ...(revocationKeyHash !== undefined
          ? { revocationKeyHash }
          : {}),
      },
      select: {
        id: true,
        platform: true,
        isActive: true,
      },
    });

    return { success: true, device };
  }

  async unregisterDevice(params: {
    businessId: string;
    userId: string;
    token: string;
  }) {
    await this.prisma.pushDevice.deleteMany({
      where: {
        businessId: params.businessId,
        userId: params.userId,
        token: params.token,
      },
    });
    return { success: true };
  }

  // Não é exposto por HTTP até existir um controller de revogação seguro.
  async revokeDeviceByKey(revocationKey: string) {
    const hash = createHash('sha256').update(revocationKey).digest('hex');
    const result = await this.prisma.pushDevice.deleteMany({
      where: { revocationKeyHash: hash },
    });
    return { success: true, revoked: result.count > 0 };
  }
}
