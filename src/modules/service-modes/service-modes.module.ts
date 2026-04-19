import { Module } from '@nestjs/common';
import { ServiceModesService } from './service-modes.service';
import { ServiceModesController } from './service-modes.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ServiceModesController],
  providers: [ServiceModesService],
})
export class ServiceModesModule {}