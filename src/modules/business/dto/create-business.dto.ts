import { IsString, IsOptional } from 'class-validator';

export class CreateBusinessDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}