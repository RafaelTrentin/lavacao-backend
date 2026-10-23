import { PushPlatform } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterPushDeviceDto {
  @IsEnum(PushPlatform)
  platform: PushPlatform;

  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  installationId?: string;

  @IsOptional()
  @IsString()
  @MinLength(43)
  @MaxLength(128)
  revocationKey?: string;
}

export class UnregisterPushDeviceDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token: string;
}

// Reservado para o futuro controller de revogação sem JWT.
export class RevokePushDeviceDto {
  @IsString()
  @MinLength(43)
  @MaxLength(128)
  revocationKey: string;
}
