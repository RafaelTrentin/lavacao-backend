
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  ValidationPipe,
  UseGuards,
} from '@nestjs/common';
import { PushNotificationsService } from './push-notifications.service';
import { RevokePushDeviceDto } from './dto/register-push-device.dto';
import { ThrottlerGuard } from '@nestjs/throttler';

@UseGuards(ThrottlerGuard)
@Controller('push-notifications/devices')
export class PushDeviceRevocationController {
  constructor(
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  async revokeDevice(
    @Body(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }))
    body: RevokePushDeviceDto,
  ) {
    await this.pushNotificationsService.revokeDeviceByKey(
      body.revocationKey,
    );

    // Não revelar se a credencial correspondeu
    // a um dispositivo existente.
    return { success: true };
  }
}
