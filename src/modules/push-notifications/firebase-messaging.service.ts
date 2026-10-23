import { Injectable, Logger } from '@nestjs/common';
import {
  App,
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

@Injectable()
export class FirebaseMessagingService {
  private readonly logger = new Logger(FirebaseMessagingService.name);
  private readonly app: App | null;

  constructor() {
    this.app = this.initializeFirebase();
  }

  private initializeFirebase(): App | null {
    try {
      const existingApp = getApps().find(
        (app) => app.name === 'washsync',
      );

      if (existingApp) {
        return existingApp;
      }

      // No Railway, poderemos usar a credencial JSON
      // armazenada em uma variável de ambiente protegida.
      const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

      if (credentialsJson) {
        const credentials = JSON.parse(credentialsJson);

        const app = initializeApp(
          { credential: cert(credentials) },
          'washsync',
        );

        this.logger.log('Firebase Admin inicializado');
        return app;
      }

      // No desenvolvimento local, utilizamos o caminho
      // definido em GOOGLE_APPLICATION_CREDENTIALS.
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const app = initializeApp(
          { credential: applicationDefault() },
          'washsync',
        );

        this.logger.log('Firebase Admin inicializado localmente');
        return app;
      }

      this.logger.warn(
        'Firebase não configurado. Notificações nativas desativadas.',
      );

      return null;
    } catch (error) {
      this.logger.error(
        'Falha ao inicializar Firebase Admin',
        error instanceof Error ? error.message : String(error),
      );

      return null;
    }
  }

  isAvailable(): boolean {
    return this.app !== null;
  }

  async sendToDevice(params: {
    token: string;
    title: string;
    body: string;
    url?: string;
  }): Promise<string | null> {
    if (!this.app) {
      return null;
    }

    return getMessaging(this.app).send({
      token: params.token,
      notification: {
        title: params.title,
        body: params.body,
      },
      data: {
        url: params.url || '/notifications',
      },
      android: {
        priority: 'high',
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });
  }
}