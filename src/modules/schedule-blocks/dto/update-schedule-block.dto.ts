import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { DayOfWeek, ScheduleBlockType } from 'src/common/enums';
import { normalizeDays, trimString } from './create-schedule-block.dto';

// Preserve the existing PUT's persisted date fields, without accepting Prisma
// relations, tenant ownership, IDs or deletion metadata from the caller.
export class UpdateScheduleBlockDto {
  @ValidateIf((_dto, value) => value !== undefined) @IsEnum(ScheduleBlockType)
  type?: ScheduleBlockType;

  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(trimString) @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  startAt?: string;

  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(trimString) @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  endAt?: string;

  @IsOptional() @Transform(trimString) @IsString()
  reason?: string;

  @ValidateIf((_dto, value) => value !== undefined) @IsBoolean()
  isRecurring?: boolean;

  @IsOptional() @Transform(normalizeDays) @IsArray() @ArrayMaxSize(7) @ArrayUnique() @IsEnum(DayOfWeek, { each: true })
  recurringDays?: DayOfWeek[];

  @IsOptional() @Transform(trimString) @IsDateString({ strict: true })
  recurringEndDate?: string;

  @ValidateIf((_dto, value) => value !== undefined) @IsBoolean()
  isActive?: boolean;
}
