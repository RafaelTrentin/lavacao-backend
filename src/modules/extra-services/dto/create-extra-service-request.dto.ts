import { IsString, IsOptional } from 'class-validator';

export class CreateExtraServiceRequestDto {
  @IsString()
  extraServiceId: string;

  @IsOptional()
  @IsString()
  description?: string;
}