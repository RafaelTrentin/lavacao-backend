import { IsObject, IsNumber, IsOptional, IsString, IsInt, Min } from 'class-validator';

export class UpdateBusinessSettingsDto {
  @IsOptional()
  @IsObject()
  operatingHoursJson?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  searchFeeUpTo5km?: number;

  @IsOptional()
  @IsNumber()
  searchFeeOver5km?: number;

  @IsOptional()
  @IsNumber()
  searchFeeLimitKm?: number;

  @IsOptional()
  @IsString()
  whatsappPhone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  minimumAdvanceMinutes?: number;
}
