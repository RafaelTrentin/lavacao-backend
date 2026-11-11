import { IsDateString, IsString, IsOptional, IsIn } from 'class-validator';

export class GetAvailableSlotsDto {
  @IsOptional() @IsIn(['true'])
  includeStatus?: string;
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
