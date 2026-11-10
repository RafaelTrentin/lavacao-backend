import { IsArray, IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { DayOfWeek, ScheduleBlockType } from 'src/common/enums';

// Preserve the existing PUT's persisted date fields, without accepting Prisma
// relations, tenant ownership, IDs or deletion metadata from the caller.
export class UpdateScheduleBlockDto {
  @IsOptional() @IsEnum(ScheduleBlockType)
  type?: ScheduleBlockType;

  @IsOptional() @IsDateString()
  startAt?: string;

  @IsOptional() @IsDateString()
  endAt?: string;

  @IsOptional() @IsString()
  reason?: string;

  @IsOptional() @IsBoolean()
  isRecurring?: boolean;

  @IsOptional() @IsArray() @IsEnum(DayOfWeek, { each: true })
  recurringDays?: DayOfWeek[];

  @IsOptional() @IsDateString()
  recurringEndDate?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
