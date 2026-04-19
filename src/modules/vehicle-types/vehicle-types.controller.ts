import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { AdminGuard } from 'src/common/guards/admin.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import { VehicleTypesService } from './vehicle-types.service';
import { CreateVehicleTypeDto } from './dto/create-vehicle-type.dto';
import { UpdateVehicleTypeDto } from './dto/update-vehicle-type.dto';

@Controller()
export class VehicleTypesController {
  constructor(private readonly vehicleTypesService: VehicleTypesService) {}

  @Get('vehicle-types')
  @UseGuards(JwtGuard)
  async listAuthenticated(@CurrentUser() user: CurrentUserPayload) {
    return this.vehicleTypesService.list(user.businessId);
  }

  @Get('admin/vehicle-types')
  @UseGuards(JwtGuard, AdminGuard)
  async listAdmin(@CurrentUser() user: CurrentUserPayload) {
    return this.vehicleTypesService.list(user.businessId);
  }

  @Post('admin/vehicle-types')
  @UseGuards(JwtGuard, AdminGuard)
  async create(
    @Body() data: CreateVehicleTypeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.vehicleTypesService.create(user.businessId, data);
  }

  @Put('admin/vehicle-types/:id')
  @UseGuards(JwtGuard, AdminGuard)
  async update(
    @Param('id') id: string,
    @Body() data: UpdateVehicleTypeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.vehicleTypesService.update(id, user.businessId, data);
  }

  @Delete('admin/vehicle-types/:id')
  @UseGuards(JwtGuard, AdminGuard)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.vehicleTypesService.delete(id, user.businessId);
  }
}