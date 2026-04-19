import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { BusinessService } from './business.service';

@Controller('public/business')
export class PublicBusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Get('empresa/:slug')
  async getBusinessBySlug(@Param('slug') slug: string) {
    const business = await this.businessService.getPublicBusinessBySlug(slug);

    if (!business) {
      throw new NotFoundException('Empresa não encontrada');
    }

    return business;
  }
}