import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class WalkInDto {
  @IsString() @IsNotEmpty() customerId: string;
  @IsString() @IsNotEmpty() serviceModeId: string;
  @IsString() @IsNotEmpty() vehicleType: string;
  @IsUUID() requestKey: string;
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(120)
  vehicleDescription?: string;
}
