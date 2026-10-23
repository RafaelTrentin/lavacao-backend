
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PushNotificationsService } from './push-notifications.service';
import { PushNotificationsController } from './push-notifications.controller';
import { PushDeviceRevocationController } from './push-device-revocation.controller';
import { FirebaseMessagingService } from './firebase-messaging.service';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
  PrismaModule,
  ThrottlerModule.forRoot([
    {
      ttl: 60_000,
      limit: 10,
    },
  ]),
],
  controllers: [
    PushNotificationsController,
    PushDeviceRevocationController,
  ],
  providers: [
    PushNotificationsService,
    FirebaseMessagingService,
  ],
  exports: [
    PushNotificationsService,
    FirebaseMessagingService,
  ],
})
export class PushNotificationsModule {}
