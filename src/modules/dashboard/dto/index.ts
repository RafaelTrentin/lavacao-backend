import { IsDateString, IsOptional } from 'class-validator';

export class DaySummaryDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class ReportPeriodDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}