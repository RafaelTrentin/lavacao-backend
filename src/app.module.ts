import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessModule } from './modules/business/business.module';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ServiceModesModule } from './modules/service-modes/service-modes.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { ScheduleBlocksModule } from './modules/schedule-blocks/schedule-blocks.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { ExtraServicesModule } from './modules/extra-services/extra-services.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { VehicleTypesModule } from './modules/vehicle-types/vehicle-types.module';
import { MapsModule } from './modules/maps/maps.module';
import { PushNotificationsModule } from './modules/push-notifications/push-notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret-key',
      signOptions: { expiresIn: process.env.JWT_EXPIRATION || '24h' } as any,
    }),
    AuthModule,
    BusinessModule,
    UsersModule,
    CustomersModule,
    ServiceModesModule,
    AppointmentsModule,
    AvailabilityModule,
    ScheduleBlocksModule,
    AddressesModule,
    ExtraServicesModule,
    DashboardModule,
    VehicleTypesModule,
    MapsModule,
    NotificationsModule,
    PushNotificationsModule,
  ],
})
export class AppModule {}