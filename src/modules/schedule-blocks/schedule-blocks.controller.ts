import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { AdminGuard } from 'src/common/guards/admin.guard';
import { CurrentUser, CurrentUserPayload } from 'src/common/decorators/current-user.decorator';
import { ScheduleBlocksService } from './schedule-blocks.service';
import { CreateScheduleBlockDto } from './dto/create-schedule-block.dto';

@Controller('admin/schedule-blocks')
@UseGuards(JwtGuard, AdminGuard)
export class ScheduleBlocksController {
  constructor(private scheduleBlocksService: ScheduleBlocksService) {}

  @Post()
  async create(
    @Body() createScheduleBlockDto: CreateScheduleBlockDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.scheduleBlocksService.createScheduleBlock(
      user.businessId,
      createScheduleBlockDto,
    );
  }

  @Get()
  async getAll(@CurrentUser() user: CurrentUserPayload) {
    return this.scheduleBlocksService.getScheduleBlocksByBusiness(
      user.businessId,
    );
  }

  @Put(':id')
  async update(
    @Param('id') blockId: string,
    @Body() updateData: any,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.scheduleBlocksService.updateScheduleBlock(
      blockId,
      user.businessId,
      updateData,
    );
  }

  @Delete(':id')
  async delete(
    @Param('id') blockId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.scheduleBlocksService.deleteScheduleBlock(
      blockId,
      user.businessId,
    );
  }
}