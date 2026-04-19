import {
  IsBoolean,
  IsOptional,
  IsString,
  ValidateIf,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EstimateSearchFeeDto {
  @IsString()
  serviceModeId: string;

  @IsString()
  vehicleType: string;

  @IsBoolean()
  willSearchVehicle: boolean;

  @IsOptional()
  @IsString()
  searchType?: string;

  @ValidateIf((obj) => obj.searchType === 'MANUAL_ADDRESS')
  @IsOptional()
  @IsString()
  serviceAddressId?: string;

  @ValidateIf((obj) => obj.searchType === 'MANUAL_ADDRESS')
  @IsOptional()
  @IsString()
  streetAddress?: string;

  @ValidateIf((obj) => obj.searchType === 'MANUAL_ADDRESS')
  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ValidateIf((obj) => obj.searchType === 'MANUAL_ADDRESS')
  @IsOptional()
  @IsString()
  city?: string;

  @ValidateIf((obj) => obj.searchType === 'MANUAL_ADDRESS')
  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zipCode?: string;

  @ValidateIf((obj) => obj.searchType === 'CURRENT_LOCATION')
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ValidateIf((obj) => obj.searchType === 'CURRENT_LOCATION')
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  pickupReference?: string;
}