import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateExtraServiceDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsNumber()
  estimatedPriceInCents?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}