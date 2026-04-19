import {
  IsString,
  IsDateString,
  IsBoolean,
  IsOptional,
  ValidateIf,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SearchType, AddressType } from 'src/common/enums';

export class CreateAppointmentDto {
  @IsString()
  serviceModeId: string;

  @IsString()
  vehicleType: string;

  @IsDateString()
  scheduledStartAt: string;

  @IsBoolean()
  willSearchVehicle: boolean;

  @ValidateIf((obj) => obj.willSearchVehicle === true)
  @IsOptional()
  @Type(() => String)
  @IsString()
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
  latitude?: number;

  @ValidateIf(
    (obj) =>
      obj.willSearchVehicle === true &&
      obj.searchType === SearchType.CURRENT_LOCATION,
  )
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  pickupReference?: string;
}