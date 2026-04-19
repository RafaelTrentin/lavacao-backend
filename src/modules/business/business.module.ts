import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MapsModule } from '../maps/maps.module';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { PublicBusinessController } from './public-business.controller';

@Module({
  imports: [PrismaModule, MapsModule],
  controllers: [BusinessController, PublicBusinessController],
  providers: [BusinessService],
  exports: [BusinessService],
})
export class BusinessModule {}