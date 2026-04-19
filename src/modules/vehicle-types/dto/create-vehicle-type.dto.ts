import { IsString } from 'class-validator';

export class CreateVehicleTypeDto {
  @IsString()
  kind: string;

  @IsString()
  displayName: string;
}