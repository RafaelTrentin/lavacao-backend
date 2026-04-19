import { IsOptional, IsString } from 'class-validator';

export class UpdateVehicleTypeDto {
  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}