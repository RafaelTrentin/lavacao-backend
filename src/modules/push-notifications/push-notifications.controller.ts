import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { PushNotificationsService } from './push-notifications.service';

@Controller('push-notifications')
@UseGuards(JwtGuard)
export class PushNotificationsController {
  constructor(
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

  @Get('public-key')
  async getPublicKey() {
    return this.pushNotificationsService.getPublicKey();
  }

  @Post('subscribe')
  async subscribe(
    @Body()
    body: {
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
    },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pushNotificationsService.saveSubscription({
      businessId: user.businessId,
      userId: user.userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
  }

  @Delete('unsubscribe')
  async unsubscribe(
    @Body() body: { endpoint: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pushNotificationsService.removeSubscription(
      body.endpoint,
      user.userId,
      user.businessId,
    );
  }
}