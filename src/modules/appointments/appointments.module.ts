import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AvailabilityModule } from '../availability/availability.module';
import { DistanceUtil } from 'src/common/utils/distance.util';
import { MapsModule } from '../maps/maps.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

@Module({
  imports: [PrismaModule, AvailabilityModule, MapsModule, NotificationsModule, PushNotificationsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, DistanceUtil],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}