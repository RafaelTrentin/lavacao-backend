import { IsDateString, Matches } from 'class-validator';

export class RescheduleAppointmentDto {
  @IsDateString()
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  newScheduledStartAt: string;
}
