import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsNotEmpty, IsString } from 'class-validator';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { PushNotificationsService } from './push-notifications.service';

export class RevokeWebPushDto extends SubscribePushDto {
  @IsString() @IsNotEmpty() userId: string;
  @IsString() @IsNotEmpty() businessId: string;
}

// Possession of BOTH subscription keys authorizes only deletion of that binding.
// No JWT from the previous account is retained for offline cleanup.
@Controller('push-notifications/web')
@UseGuards(ThrottlerGuard)
export class WebPushRevocationController {
  constructor(private readonly push: PushNotificationsService) {}

  @Post('revoke')
  @HttpCode(200)
  async revoke(@Body() body: RevokeWebPushDto) {
    await this.push.revokeWebSubscription(body);
    return { success: true };
  }
}
