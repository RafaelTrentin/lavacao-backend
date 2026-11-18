import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreateWashBoxDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(80)
  name: string;

  @ValidateIf((_, value) => value !== undefined) @IsBoolean()
  isActive?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @IsNotEmpty({ each: true })
  serviceModeIds?: string[];
}

export class UpdateWashBoxDto extends CreateWashBoxDto {
  @ValidateIf((_, value) => value !== undefined)
  name: string;
}
