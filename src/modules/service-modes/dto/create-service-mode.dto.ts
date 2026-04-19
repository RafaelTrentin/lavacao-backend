import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateServiceModeDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsBoolean()
  isActive: boolean;
}