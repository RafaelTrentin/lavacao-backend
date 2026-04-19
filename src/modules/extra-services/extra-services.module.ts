import { Module } from '@nestjs/common';
import { ExtraServicesService } from './extra-services.service';
import { ExtraServicesController } from './extra-services.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExtraServicesController],
  providers: [ExtraServicesService],
})
export class ExtraServicesModule {}