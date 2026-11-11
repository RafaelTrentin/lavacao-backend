import { AvailabilityService } from './modules/availability/availability.service';
import { AppointmentsService } from './modules/appointments/appointments.service';
import { AppointmentsController } from './modules/appointments/appointments.controller';
import { ScheduleBlocksService } from './modules/schedule-blocks/schedule-blocks.service';

describe('Server appointment time policy', () => {
  let db: any;
  let availability: AvailabilityService;
  let appointments: AppointmentsService;
  let blocks: ScheduleBlocksService;
  let business: any;
  let occupied: any[];
  let scheduleBlocks: any[];
  let appointment: any;
  const allDays = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const hours = (open: string, close: string) => Object.fromEntries(allDays.map((day) => [day, [{ open, close }]]));
  const dto = (start: string) => ({ serviceModeId: 'mode', vehicleType: 'CAR', scheduledStartAt: start, willSearchVehicle: false } as any);

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-08T12:00:00Z'));
    business = { id: 'a', timezone: 'UTC', isActive: true, deletedAt: null,
      settings: { minimumAdvanceMinutes: 30, operatingHours: hours('00:00', '23:59'), nonOperatingDates: [] } };
    occupied = []; scheduleBlocks = [];
    appointment = { id: 'appointment', businessId: 'a', customerId: 'customer', customer: { userId: 'user' },
      serviceModeId: 'mode', vehicleType: 'CAR', status: 'CONFIRMED', deletedAt: null, snapshotDurationMinutes: 40,
      bookingNumber: 'fixture', scheduledStartAt: new Date('2030-01-09T12:00:00Z') };
    db = {
      $queryRaw: jest.fn(async () => [{ id: 'a' }]),
      business: { findUnique: jest.fn(async () => business) },
      user: { findMany: jest.fn(async () => []) },
      customerProfile: { findUnique: jest.fn(async () => ({ id: 'customer', userId: 'user', businessId: 'a' })) },
      serviceMode: { findUnique: jest.fn(async () => ({ id: 'mode', businessId: 'a', isActive: true, name: 'Fixture' })) },
      serviceModeRule: { findFirst: jest.fn(async () => ({ id: 'rule', durationMinutes: 40, basePriceInCents: 1000 })) },
      appointment: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => appointment),
        findMany: jest.fn(),
        create: jest.fn(async ({ data }) => ({ ...data, id: 'new', createdAt: new Date() })),
        update: jest.fn(async ({ data }) => ({ ...appointment, ...data })),
      },
      appointmentStatusHistory: { create: jest.fn(async () => ({})) },
      scheduleBlock: {
        findMany: jest.fn(async () => scheduleBlocks),
        create: jest.fn(async ({ data }) => { const block = { ...data, id: 'block', isActive: true }; scheduleBlocks.push(block); return block; }),
      },
    };
    // Query doubles validate business rules; concurrency has a separate real-PG suite.
    db.appointment.findMany.mockImplementation(async ({ where }) => occupied.filter((a) =>
      a.scheduledStartAt < where.scheduledStartAt.lt && a.scheduledEndAt > where.scheduledEndAt.gt));
    db.$transaction = jest.fn(async (work) => work(db));
    availability = new AvailabilityService(db);
    const notify = { createForUser: jest.fn(async (data) => ({ id: 'event', ...data })), sendToUser: jest.fn() };
    appointments = new AppointmentsService(db, availability, {} as any, notify as any, notify as any);
    blocks = new ScheduleBlocksService(db);
  });
  afterEach(() => jest.useRealTimers());

  it.each(['2030-01-07T15:00:00Z', '2030-01-08T11:59:00Z', '2030-01-08T12:29:59Z'])('rejects creation in the past/below advance: %s', async (start) => {
    await expect(appointments.createAppointment('a', 'customer', 'user', dto(start))).rejects.toMatchObject({ status: 400 });
    expect(db.appointment.create).not.toHaveBeenCalled();
  });
  it('allows the exact advance boundary on the current day', async () => {
    await expect(appointments.createAppointment('a', 'customer', 'user', dto('2030-01-08T12:30:00Z')))
      .resolves.toMatchObject({ scheduledStartAt: new Date('2030-01-08T12:30:00Z') });
  });
  it('preserves zero advance rather than replacing it with 15', async () => {
    business.settings.minimumAdvanceMinutes = 0;
    await expect(appointments.createAppointment('a', 'customer', 'user', dto('2030-01-08T12:00:00Z'))).resolves.toBeDefined();
    await expect(appointments.createAppointment('a', 'customer', 'user', dto('2030-01-08T11:59:59Z'))).rejects.toMatchObject({ status: 400 });
  });
  it.each(['admin', 'customer'])('rechecks minimum advance on %s rescheduling', async (role) => {
    const start = new Date('2030-01-08T12:15:00Z');
    const result = role === 'admin' ? appointments.rescheduleAppointment('appointment', 'a', start, 'admin')
      : appointments.rescheduleCustomerAppointment('appointment', 'a', 'customer', start);
    await expect(result).rejects.toMatchObject({ status: 400 });
    expect(db.appointment.update).not.toHaveBeenCalled();
  });
  it('has no hidden admin bypass for past or advance', async () => {
    const controller = new AppointmentsController(appointments, db);
    await expect(controller.createByAdmin({ customerId: 'customer', appointment: dto('2030-01-08T12:15:00Z') },
      { businessId: 'a', userId: 'admin', role: 'ADMIN' } as any)).rejects.toMatchObject({ status: 400 });
  });
  it('requires the whole duration to fit in opening hours', async () => {
    business.settings.operatingHours = hours('08:00', '13:00');
    await expect(appointments.createAppointment('a', 'customer', 'user', dto('2030-01-08T12:30:00Z'))).rejects.toMatchObject({ status: 400 });
  });
  it('respects closed dates and active blocks at write time', async () => {
    business.settings.nonOperatingDates = ['2030-01-08'];
    await expect(appointments.createAppointment('a', 'customer', 'user', dto('2030-01-08T13:00:00Z'))).rejects.toMatchObject({ status: 400 });
    business.settings.nonOperatingDates = [];
    scheduleBlocks.push({ startAt: new Date('2030-01-08T13:15:00Z'), endAt: new Date('2030-01-08T14:00:00Z') });
    await expect(appointments.createAppointment('a', 'customer', 'user', dto('2030-01-08T13:00:00Z'))).rejects.toMatchObject({ status: 400 });
  });
  it('returns only slots that the authoritative validation accepts', async () => {
    business.timezone = 'Pacific/Kiritimati';
    business.settings.operatingHours = hours('00:00', '04:00');
    const slots = await availability.getAvailableSlots('a', '2030-01-09', 'CAR', 'mode');
    expect(slots[0].startTime).toBe('02:30'); // Jan 8 12:00 UTC = Jan 9 02:00 UTC+14.
    for (const slot of slots) expect(await availability.validateSlotAvailability('a', new Date(slot.scheduledStartAt), '', 'CAR', 'mode', { exactStart: true })).toBe(true);
  });
  it('handles dawn crossing a UTC date and overlaps carried from the previous day', async () => {
    business.timezone = 'Asia/Kathmandu';
    business.settings.operatingHours = hours('00:00', '04:00');
    occupied.push({ scheduledStartAt: new Date('2030-01-08T18:00:00Z'), scheduledEndAt: new Date('2030-01-08T18:45:00Z') });
    const slots = await availability.getAvailableSlots('a', '2030-01-09', 'CAR', 'mode');
    expect(slots[0]).toMatchObject({ startTime: '00:30', scheduledStartAt: '2030-01-08T18:45:00.000Z' });
  });
  it('skips the DST gap and distinguishes repeated slots by UTC', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    business.timezone = 'America/New_York'; business.settings.operatingHours = hours('00:00', '04:00');
    const spring = await availability.getAvailableSlots('a', '2027-03-14', 'CAR', 'mode');
    expect(spring.some((slot) => slot.startTime.startsWith('02:'))).toBe(false);
    const autumn = await availability.getAvailableSlots('a', '2027-11-07', 'CAR', 'mode');
    const repeated = autumn.filter((slot) => slot.startTime === '01:30');
    expect(repeated.map((slot) => slot.scheduledStartAt)).toEqual(['2027-11-07T05:30:00.000Z', '2027-11-07T06:30:00.000Z']);
    expect(repeated[0].displayLabel).not.toBe(repeated[1].displayLabel);
    for (const slot of repeated) expect(await availability.validateSlotAvailability('a', new Date(slot.scheduledStartAt), '', 'CAR', 'mode', { exactStart: true })).toBe(true);
    expect(await availability.validateSlotAvailability('a', '2027-11-07', '01:30', 'CAR', 'mode')).toBe(false);
  });
  it('creates full-day blocks using 23/25-hour IANA days', async () => {
    business.timezone = 'America/New_York';
    for (const [date, duration] of [['2027-03-14', 23], ['2027-11-07', 25]] as const) {
      const result = await blocks.createScheduleBlock('a', { type: 'FULL_DAY', blockDate: date } as any);
      expect((result.endAt.getTime() - result.startAt.getTime()) / 3600000).toBe(duration);
    }
  });
  it('rejects nonexistent/ambiguous wall time when creating blocks', async () => {
    business.timezone = 'America/New_York';
    for (const [date, time] of [['2027-03-14', '02:30'], ['2027-11-07', '01:30']]) {
      await expect(blocks.createScheduleBlock('a', { type: 'TIME_RANGE', blockDate: date, blockStartTime: time, blockEndTime: '04:00' } as any))
        .rejects.toMatchObject({ status: 400 });
    }
  });
  it('projects recurring blocks to the queried date without changing stored anchors', async () => {
    business.timezone = 'America/Sao_Paulo';
    const block = await blocks.createScheduleBlock('a', { type: 'TIME_RANGE', blockDate: '2030-01-01',
      blockStartTime: '10:00', blockEndTime: '11:00', isRecurring: true, recurringDays: ['TUESDAY'], recurringEndDate: '2030-01-08' } as any);
    expect(block.startAt.toISOString()).toBe('2030-01-01T13:00:00.000Z');
    expect(await availability.validateSlotAvailability('a', '2030-01-08', '10:00', 'CAR', 'mode')).toBe(false);
    expect(await availability.validateSlotAvailability('a', '2030-01-15', '10:00', 'CAR', 'mode')).toBe(true);
    expect(block.startAt.toISOString()).toBe('2030-01-01T13:00:00.000Z');
  });
  it('queries the administrative day with company-local UTC boundaries', async () => {
    business.timezone = 'America/Manaus';
    db.appointment.findMany.mockResolvedValue([]);
    await appointments.getAppointmentsByDate('a', '2030-01-08');
    expect(db.appointment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({
      scheduledStartAt: { gte: new Date('2030-01-08T04:00:00Z'), lt: new Date('2030-01-09T04:00:00Z') },
    }) }));
  });
  it('does not drop a recurring block when its boundary falls in a DST gap', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    business.timezone = 'America/New_York';
    await blocks.createScheduleBlock('a', { type: 'TIME_RANGE', blockDate: '2027-03-07',
      blockStartTime: '01:30', blockEndTime: '02:30', isRecurring: true, recurringDays: ['SUNDAY'] } as any);
    expect(await availability.getAvailableSlots('a', '2027-03-14', 'CAR', 'mode')).toEqual([]);
  });
});
