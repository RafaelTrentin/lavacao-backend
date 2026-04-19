import { IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateAppointmentDto } from './create-appointment.dto';

export class CreateAdminAppointmentDto {
  @IsString()
  customerId: string;

  @ValidateNested()
  @Type(() => CreateAppointmentDto)
  appointment: CreateAppointmentDto;
}