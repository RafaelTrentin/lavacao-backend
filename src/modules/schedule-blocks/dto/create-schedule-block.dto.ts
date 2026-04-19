import {
  IsString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { ScheduleBlockType } from 'src/common/enums';

export class CreateScheduleBlockDto {
  @IsEnum(ScheduleBlockType)
  type: ScheduleBlockType;

  @IsDateString()
  blockDate: string;

  @IsOptional()
  @IsString()
  blockStartTime?: string;

  @IsOptional()
  @IsString()
  blockEndTime?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsArray()
  recurringDays?: string[];

  @IsOptional()
  @IsDateString()
  recurringEndDate?: string;
}