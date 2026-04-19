export enum UserRole {
  ADMIN = 'ADMIN',
  CUSTOMER = 'CUSTOMER',
}

export enum VehicleKind {
  CAR = 'CAR',
  MOTORCYCLE = 'MOTORCYCLE',
}

export enum AppointmentStatus {
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

export enum ExtraServiceRequestStatus {
  PENDING = 'PENDING',
  QUOTED = 'QUOTED',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum AddressType {
  RESIDENTIAL = 'RESIDENTIAL',
  COMMERCIAL = 'COMMERCIAL',
  OTHER = 'OTHER',
}

export enum ScheduleBlockType {
  FULL_DAY = 'FULL_DAY',
  TIME_RANGE = 'TIME_RANGE',
}

export enum DayOfWeek {
  SUNDAY = 'SUNDAY',
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
}

export enum SearchType {
  CURRENT_LOCATION = 'CURRENT_LOCATION',
  MANUAL_ADDRESS = 'MANUAL_ADDRESS',
}

export const APPOINTMENT_STATUS_TRANSITIONS: Record<
  AppointmentStatus,
  AppointmentStatus[]
> = {
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.IN_PROGRESS]: [AppointmentStatus.COMPLETED],
  [AppointmentStatus.COMPLETED]: [],
  [AppointmentStatus.CANCELLED]: [],
  [AppointmentStatus.NO_SHOW]: [AppointmentStatus.CONFIRMED],
};

export const CANCELABLE_STATUSES = [AppointmentStatus.CONFIRMED];

export const RESCHEDULE_ALLOWED_STATUSES = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.NO_SHOW,
];