import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { AdminGuard } from 'src/common/guards/admin.guard';
import { CurrentUser, CurrentUserPayload } from 'src/common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';
import { DaySummaryDto, ReportPeriodDto } from './dto';

@Controller('admin/dashboard')
@UseGuards(JwtGuard, AdminGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('summary')
async getDaySummary(
  @Query() query: DaySummaryDto,
  @CurrentUser() user: CurrentUserPayload,
) {
  try {
    const date = query.date ? this.parseLocalDate(query.date) : new Date();

    if (!date || isNaN(date.getTime())) {
      throw new BadRequestException('Data inválida');
    }

    return this.dashboardService.getDaySummary(user.businessId, date);
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('Erro ao buscar resumo do dia');
  }
}

  @Get('revenue-period')
  async getRevenuePeriod(
    @Query() query: ReportPeriodDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    try {
      const startDate = new Date(query.startDate);
      const endDate = new Date(query.endDate);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new BadRequestException('Datas inválidas');
      }

      if (startDate > endDate) {
        throw new BadRequestException(
          'Data inicial deve ser anterior à data final',
        );
      }

      return this.dashboardService.getRevenueByPeriod(
        user.businessId,
        startDate,
        endDate,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao buscar receita');
    }
  }

  @Get('distribution-by-service')
  async getDistributionByService(
    @Query() query: ReportPeriodDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    try {
      const startDate = new Date(query.startDate);
      const endDate = new Date(query.endDate);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new BadRequestException('Datas inválidas');
      }

      return this.dashboardService.getDistributionByServiceMode(
        user.businessId,
        startDate,
        endDate,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao buscar distribuição');
    }
  }

  @Get('vehicle-distribution')
  async getVehicleDistribution(
    @Query() query: ReportPeriodDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    try {
      const startDate = new Date(query.startDate);
      const endDate = new Date(query.endDate);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new BadRequestException('Datas inválidas');
      }

      return this.dashboardService.getVehicleDistribution(
        user.businessId,
        startDate,
        endDate,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao buscar distribuição de veículos');
    }
  }

  @Get('cancelled-analysis')
  async getCancelledAnalysis(
    @Query() query: ReportPeriodDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    try {
      const startDate = new Date(query.startDate);
      const endDate = new Date(query.endDate);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new BadRequestException('Datas inválidas');
      }

      return this.dashboardService.getCancelledAnalysis(
        user.businessId,
        startDate,
        endDate,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao buscar análise de cancelamentos');
    }
  }

  @Get('top-customers')
  async getTopCustomers(
    @Query() query: ReportPeriodDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    try {
      const startDate = new Date(query.startDate);
      const endDate = new Date(query.endDate);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new BadRequestException('Datas inválidas');
      }

      return this.dashboardService.getTopCustomers(
        user.businessId,
        startDate,
        endDate,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao buscar top clientes');
    }
  }

  @Get('top-customers-period')
async getTopCustomersByPeriod(
  @Query('period') period: 'WEEK' | 'MONTH',
  @CurrentUser() user: CurrentUserPayload,
) {
  try {
    return this.dashboardService.getTopCustomersByPeriod(
      user.businessId,
      period || 'MONTH',
    );
      } catch (error) {
    throw new BadRequestException('Erro ao buscar ranking de clientes');
    }
  }

  private parseLocalDate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);

  if (!match) {
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);

  const date = new Date(year, month, day, 0, 0, 0, 0);

  if (isNaN(date.getTime())) return null;

  return date;
}
}