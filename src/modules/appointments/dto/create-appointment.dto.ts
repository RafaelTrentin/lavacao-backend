import {
  IsString,
  IsDateString,
  IsBoolean,
  IsOptional,
  ValidateIf,
  IsNumber,
  Matches,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SearchType, AddressType } from 'src/common/enums';

export class CreateAppointmentDto {
  @IsString()
  serviceModeId: string;

  @IsString()
  vehicleType: string;

  @IsDateString()
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  scheduledStartAt: string;

  @IsBoolean()
  willSearchVehicle: boolean;

  @ValidateIf((obj) => obj.willSearchVehicle === true)
  @IsOptional()
  @Type(() => String)
  @IsString()
  @IsEnum(SearchType)
  searchType?: SearchType;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.MANUAL_ADDRESS,
  )
  @IsOptional()
  @IsString()
  serviceAddressId?: string;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.MANUAL_ADDRESS,
  )
  @IsOptional()
  @IsString()
  streetAddress?: string;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.MANUAL_ADDRESS,
  )
  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  complement?: string;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.MANUAL_ADDRESS,
  )
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.MANUAL_ADDRESS,
  )
  @IsOptional()
  @IsString()
  city?: string;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.MANUAL_ADDRESS,
  )
  @IsOptional()
  @IsString()
  state?: string;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.MANUAL_ADDRESS,
  )
  @IsOptional()
  @IsString()
  zipCode?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  addressType?: AddressType;

  @IsOptional()
  @IsString()
  addressLabel?: string;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.CURRENT_LOCATION,
  )
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90) @Max(90)
  latitude?: number;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.CURRENT_LOCATION,
  )
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180) @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  pickupReference?: string;
}
