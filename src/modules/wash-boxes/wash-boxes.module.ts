import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WashBoxesController } from './wash-boxes.controller';
import { WashBoxesService } from './wash-boxes.service';
@Module({ imports: [PrismaModule], controllers: [WashBoxesController], providers: [WashBoxesService] })
export class WashBoxesModule {}
