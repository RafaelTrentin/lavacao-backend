import { IsDateString, IsString } from 'class-validator';

export class GetAvailableSlotsDto {
  @IsDateString()
  date: string;

  @IsString()
  vehicleType: string;

  @IsString()
  serviceModeId: string;
}

export class ValidateSlotDto {
  @IsDateString()
  date: string;

  @IsString()
  vehicleType: string;

  @IsString()
  serviceModeId: string;

  @IsString()
  time: string;
}