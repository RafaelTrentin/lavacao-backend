import { IsNumber, IsString } from 'class-validator';

export class ServiceModeRuleDto {
  @IsString()
  vehicleTypeKind: string;

  @IsNumber()
  durationMinutes: number;

  @IsNumber()
  basePriceInCents: number;
}