import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CreateWashBoxDto, UpdateWashBoxDto } from './wash-box.dto';
import { WashBoxesService } from './wash-boxes.service';

@Controller('admin/wash-boxes')
@UseGuards(JwtGuard, AdminGuard)
export class WashBoxesController {
  constructor(private boxes: WashBoxesService) {}
  @Get() list(@CurrentUser() user: CurrentUserPayload) { return this.boxes.list(user.businessId); }
  @Post() create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateWashBoxDto) {
    return this.boxes.create(user.businessId, dto);
  }
  @Put(':id') update(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: UpdateWashBoxDto) {
    return this.boxes.update(user.businessId, id, dto);
  }
}
