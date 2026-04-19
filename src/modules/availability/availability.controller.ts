import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { AvailabilityService } from './availability.service';
import {
  GetAvailableSlotsDto,
  ValidateSlotDto,
} from './dto/get-available-slots.dto';

@Controller('availability')
@UseGuards(JwtGuard)
export class AvailabilityController {
  constructor(private availabilityService: AvailabilityService) {}

  @Get('slots')
  async getAvailableSlots(
    @Query() query: GetAvailableSlotsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    try {
      const date = this.parseDateOnly(query.date);

      return this.availabilityService.getAvailableSlots(
        user.businessId,
        date,
        query.vehicleType,
        query.serviceModeId,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao buscar slots disponíveis');
    }
  }

  @Get('validate')
  async validateSlot(
    @Query() query: ValidateSlotDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    try {
      const date = this.parseDateOnly(query.date);

      if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(query.time)) {
        throw new BadRequestException(
          'Hora deve estar em formato HH:mm (00:00 - 23:59)',
        );
      }

      const isValid = await this.availabilityService.validateSlotAvailability(
        user.businessId,
        date,
        query.time,
        query.vehicleType,
        query.serviceModeId,
      );

      return { isValid };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao validar slot');
    }
  }

  private parseDateOnly(dateStr: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);

    if (!match) {
      throw new BadRequestException(
        'Data inválida. Use o formato YYYY-MM-DD',
      );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    if (isNaN(date.getTime())) {
      throw new BadRequestException('Data inválida');
    }

    return date;
  }
}