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
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { ServiceModesService } from './service-modes.service';
import { CreateServiceModeDto } from './dto/create-service-mode.dto';
import { UpdateServiceModeDto } from './dto/update-service-mode.dto';
import { ServiceModeRuleDto } from './dto/service-mode-rule.dto';

@Controller()
export class ServiceModesController {
  constructor(private serviceModeService: ServiceModesService) {}

  // CLIENT / AUTHENTICATED
  @Get('service-modes')
  @UseGuards(JwtGuard)
  async getAllForAuthenticatedUser(@CurrentUser() user: CurrentUserPayload) {
    return this.serviceModeService.getServiceModesByBusiness(user.businessId);
  }

  @Get('service-modes/:id')
  @UseGuards(JwtGuard)
  async getByIdForAuthenticatedUser(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.serviceModeService.getServiceModeById(id, user.businessId);
  }

  // ADMIN
  @Post('admin/service-modes')
  @UseGuards(JwtGuard, AdminGuard)
  async create(
    @Body() createServiceModeDto: CreateServiceModeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.serviceModeService.createServiceMode(
      user.businessId,
      createServiceModeDto,
    );
  }

  @Get('admin/service-modes')
  @UseGuards(JwtGuard, AdminGuard)
  async getAllAdmin(@CurrentUser() user: CurrentUserPayload) {
    return this.serviceModeService.getServiceModesByBusiness(
      user.businessId,
      true,
    );
  }

  @Get('admin/service-modes/:id')
  @UseGuards(JwtGuard, AdminGuard)
  async getByIdAdmin(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.serviceModeService.getServiceModeById(id, user.businessId);
  }

  @Put('admin/service-modes/:id')
  @UseGuards(JwtGuard, AdminGuard)
  async update(
    @Param('id') id: string,
    @Body() updateServiceModeDto: UpdateServiceModeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.serviceModeService.updateServiceMode(
      id,
      user.businessId,
      updateServiceModeDto,
    );
  }

  @Delete('admin/service-modes/:id')
  @UseGuards(JwtGuard, AdminGuard)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.serviceModeService.deleteServiceMode(id, user.businessId);
  }

  @Post('admin/service-modes/:id/rules')
  @UseGuards(JwtGuard, AdminGuard)
  async createRule(
    @Param('id') serviceModeId: string,
    @Body() ruleDto: ServiceModeRuleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.serviceModeService.createServiceModeRule(
      serviceModeId,
      user.businessId,
      ruleDto,
    );
  }

  @Put('admin/service-modes/rules/:ruleId')
  @UseGuards(JwtGuard, AdminGuard)
  async updateRule(
    @Param('ruleId') ruleId: string,
    @Body() updateData: { durationMinutes: number; basePriceInCents: number },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.serviceModeService.updateServiceModeRule(
      ruleId,
      user.businessId,
      updateData.durationMinutes,
      updateData.basePriceInCents,
    );
  }
}