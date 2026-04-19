import { AppointmentStatus } from 'src/common/enums';

export class AppointmentResponseDto {
  id: string;
  bookingNumber: string;
  status: AppointmentStatus;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  snapshotServiceModeName: string;
  snapshotTotalPriceInCents: number;
  vehicleType: string;
  willSearchVehicle: boolean;
  createdAt: Date;
}