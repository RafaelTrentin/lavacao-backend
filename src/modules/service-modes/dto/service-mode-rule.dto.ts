import { IsInt, IsString, Min } from 'class-validator';

export class ServiceModeRuleDto {
  @IsString()
  vehicleTypeKind: string;

  @IsInt() @Min(1)
  durationMinutes: number;

  @IsInt() @Min(0)
  basePriceInCents: number;
}
