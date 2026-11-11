import { IsEnum } from 'class-validator';
import { ExtraServiceRequestStatus } from '@prisma/client';

export class UpdateExtraServiceRequestStatusDto {
  @IsEnum(ExtraServiceRequestStatus)
  status: ExtraServiceRequestStatus;
}
