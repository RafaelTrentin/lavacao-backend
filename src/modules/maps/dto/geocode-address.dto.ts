import { IsOptional, IsString } from 'class-validator';

export class GeocodeAddressDto {
  @IsString()
  streetAddress: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsOptional()
  @IsString()
  zipCode?: string;
}