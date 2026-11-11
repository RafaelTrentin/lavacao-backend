import {
  IsString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DayOfWeek, ScheduleBlockType } from 'src/common/enums';

export const trimString = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export const normalizeDays = ({ value }: { value: unknown }) => Array.isArray(value)
  ? value.map((day) => typeof day === 'string' ? day.trim().toUpperCase() : day) : value;

export class CreateScheduleBlockDto {
  @IsEnum(ScheduleBlockType)
  type: ScheduleBlockType;

  @Transform(trimString)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  blockDate: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(trimString)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  blockEndDate?: string;

  @ValidateIf((dto, value) => dto.type === ScheduleBlockType.TIME_RANGE || value !== undefined)
  @Transform(trimString)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  blockStartTime?: string;

  @ValidateIf((dto, value) => dto.type === ScheduleBlockType.TIME_RANGE || value !== undefined)
  @Transform(trimString)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  blockEndTime?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  reason?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @Transform(normalizeDays)
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsEnum(DayOfWeek, { each: true })
  recurringDays?: DayOfWeek[];

  @IsOptional()
  @Transform(trimString)
  @IsDateString({ strict: true })
  recurringEndDate?: string;
}
