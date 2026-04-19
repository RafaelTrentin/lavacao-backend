import { IsObject, IsNumber, IsOptional, IsString } from 'class-validator';

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
  @IsNumber()
  minimumAdvanceMinutes?: number;
}