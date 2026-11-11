import { IsInt, Min } from 'class-validator';

export class UpdateServiceModeRuleDto {
  @IsInt() @Min(1)
  durationMinutes: number;

  @IsInt() @Min(0)
  basePriceInCents: number;
}
