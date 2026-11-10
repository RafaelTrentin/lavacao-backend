import { Type } from 'class-transformer';
import { IsDefined, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';

class SubscriptionKeysDto {
  @IsString() @IsNotEmpty()
  p256dh: string;

  @IsString() @IsNotEmpty()
  auth: string;
}

export class SubscribePushDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  endpoint: string;

  // Included by PushSubscription.toJSON() in existing browsers.
  @IsOptional() @IsNumber()
  expirationTime?: number | null;

  @IsDefined() @ValidateNested() @Type(() => SubscriptionKeysDto)
  keys: SubscriptionKeysDto;
}
