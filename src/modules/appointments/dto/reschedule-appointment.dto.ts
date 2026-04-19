import { IsDateString } from 'class-validator';

export class RescheduleAppointmentDto {
  @IsDateString()
  newScheduledStartAt: string;
}