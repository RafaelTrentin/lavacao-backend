import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { MapsService } from './maps.service';
import { GeocodeAddressDto } from './dto/geocode-address.dto';

@Controller('maps')
@UseGuards(JwtGuard)
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @Post('geocode-address')
  async geocodeAddress(@Body() dto: GeocodeAddressDto) {
    return this.mapsService.geocodeAddress(dto);
  }
}