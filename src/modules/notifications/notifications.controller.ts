import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.getMyNotifications(
      user.userId,
      user.businessId,
    );
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.getUnreadCount(
      user.userId,
      user.businessId,
    );
  }

  @Post(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.notificationsService.markAsRead(
      id,
      user.userId,
      user.businessId,
    );
  }

  @Post('read-all')
  async markAllAsRead(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.markAllAsRead(
      user.userId,
      user.businessId,
    );
  }
}