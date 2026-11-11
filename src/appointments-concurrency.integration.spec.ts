import { PrismaClient } from '@prisma/client';
import { AppointmentsService } from './modules/appointments/appointments.service';
import { AvailabilityService } from './modules/availability/availability.service';
import { ScheduleBlocksService } from './modules/schedule-blocks/schedule-blocks.service';
import { withScheduleTransaction } from './modules/appointments/schedule-transaction';
import { NotificationsService } from './modules/notifications/notifications.service';

// Never fall back to DATABASE_URL (which may point to production).
const url = process.env.WASHSYNC_CONCURRENCY_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55439' ||
      parsed.pathname !== '/washsync_concurrency_test') {
    throw new Error('Concurrency tests require the dedicated local disposable database');
  }
}
const integration = url ? describe : describe.skip;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

integration('PostgreSQL appointment concurrency', () => {
  const clients = url ? Array.from({ length: 3 }, () => new PrismaClient({ datasources: { db: { url } } })) : [];
  const db = clients[0];
  let tenant: any;
  let users: any[];
  let mode: any;
  let rule: any;
  let services: AppointmentsService[];
  let notifications: any;
  let deliveries: Promise<unknown>[];
  const drain = () => Promise.allSettled(deliveries);
  const at = (hour: number, minute = 0) => new Date(Date.UTC(2035, 0, 8, hour, minute));

  beforeEach(async () => {
    tenant = await db.business.create({ data: {
      name: 'Isolated concurrency fixture', slug: `concurrency-${Date.now()}-${Math.random()}`, timezone: 'UTC',
      settings: { create: { operatingHours: Object.fromEntries(
        ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']
          .map((day) => [day, [{ open: '06:00', close: '22:00' }]])) } },
    } });
    users = await Promise.all([0, 1].map((i) => db.user.create({ data: {
      businessId: tenant.id, email: `fixture${i}@example.invalid`, passwordHash: 'not-an-authenticatable-hash', role: 'CUSTOMER',
      customerProfile: { create: { businessId: tenant.id, name: 'Fixture', phone: '00000000000' } },
    }, include: { customerProfile: true } })));
    const vehicle = await db.vehicleType.create({ data: { businessId: tenant.id, kind: 'CAR', displayName: 'Fixture' } });
    mode = await db.serviceMode.create({ data: { businessId: tenant.id, name: 'Fixture' } });
    rule = await db.serviceModeRule.create({ data: { serviceModeId: mode.id, vehicleTypeId: vehicle.id, durationMinutes: 40, basePriceInCents: 1000 } });
    deliveries = [];
    notifications = { createForUser: jest.fn((data, tx) => new NotificationsService(db as any).createForUser(data, tx)), sendToUser: jest.fn(async () => {}) };
    services = clients.slice(1).map((client) => {
      // Widen the original read/write window with real database operations.
      // The second connection can read while the first is about to INSERT.
      const wrapped = new Proxy(client, { get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key);
        return (work: any, options: any) => target.$transaction(async (tx) => work(new Proxy(tx, { get(t, k) {
          if (k !== 'appointment') return Reflect.get(t, k);
          return new Proxy(t.appointment, { get(model, operation) {
            if (operation !== 'create' && operation !== 'update') return Reflect.get(model, operation);
            return async (args: any) => { await pause(150); return (model[operation] as any)(args); };
          } });
        } })), options);
      } });
      const service = new AppointmentsService(wrapped as any, new AvailabilityService(wrapped as any), {} as any, notifications, notifications);
      const dispatch = (service as any).dispatchCommittedEvent.bind(service);
      jest.spyOn(service as any, 'dispatchCommittedEvent').mockImplementation((...args) => {
        const delivery = dispatch(...args); deliveries.push(delivery); return delivery;
      });
      return service;
    });
  });

  afterEach(async () => {
    await drain();
    // Only fixture-owned rows in this validated, dedicated database.
    await db.appointment.deleteMany({ where: { businessId: tenant.id } });
    await db.business.delete({ where: { id: tenant.id } });
  });
  afterAll(async () => { await Promise.all(clients.map((client) => client.$disconnect())); });

  const create = (i: number, start = at(12)) => services[i].createAppointment(tenant.id, users[i].customerProfile.id, users[i].id,
    { serviceModeId: mode.id, vehicleType: 'CAR', scheduledStartAt: start.toISOString(), willSearchVehicle: false } as any);
  async function seed(i: number, hour: number) {
    return db.appointment.create({ data: {
      businessId: tenant.id, customerId: users[i].customerProfile.id, createdByUserId: users[i].id,
      serviceModeId: mode.id, serviceRuleId: rule.id, vehicleType: 'CAR',
      scheduledStartAt: at(hour), scheduledEndAt: new Date(at(hour).getTime() + 40 * 60000),
      snapshotServiceModeName: mode.name, snapshotDurationMinutes: 40, snapshotBasePriceInCents: 1000,
      snapshotTotalPriceInCents: 1000, bookingNumber: `fixture-${tenant.id}-${i}`,
    } });
  }
  async function expectOne(results: PromiseSettledResult<any>[]) {
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect([400, 409]).toContain(rejected.reason.getStatus());
    expect(await db.appointment.count({ where: { businessId: tenant.id, status: 'CONFIRMED', scheduledStartAt: at(12) } })).toBe(1);
  }

  it('allows at most one of two simultaneous bookings', async () => {
    await expectOne(await Promise.allSettled([create(0), create(1)]));
  });
  it('preserves Android 1.0.3 fixed -03:00 creation and both reschedules for Sao Paulo', async () => {
    await db.business.update({ where: { id: tenant.id }, data: { timezone: 'America/Sao_Paulo' } });
    const slots = await new AvailabilityService(db as any).getAvailableSlots(tenant.id, '2035-01-08', 'CAR', mode.id);
    expect(slots.find((slot) => slot.startTime === '08:00')?.scheduledStartAt).toBe('2035-01-08T11:00:00.000Z');
    const appointment = await services[0].createAppointment(tenant.id, users[0].customerProfile.id, users[0].id, {
      serviceModeId: mode.id, vehicleType: 'CAR', willSearchVehicle: false, scheduledStartAt: '2035-01-08T08:00:00-03:00',
    } as any);
    expect(appointment.scheduledStartAt.toISOString()).toBe('2035-01-08T11:00:00.000Z');
    const byAdmin = await services[0].rescheduleAppointment(appointment.id, tenant.id, new Date('2035-01-08T09:00:00-03:00'));
    expect(byAdmin.scheduledStartAt.toISOString()).toBe('2035-01-08T12:00:00.000Z');
    const byCustomer = await services[0].rescheduleCustomerAppointment(appointment.id, tenant.id, users[0].customerProfile.id, new Date('2035-01-08T10:00:00-03:00'));
    expect(byCustomer.scheduledStartAt.toISOString()).toBe('2035-01-08T13:00:00.000Z');
    expect(byCustomer.scheduledEndAt.toISOString()).toBe('2035-01-08T13:40:00.000Z');
  });
  it('closes inclusive days, reports existing appointments, and blocks create/reschedule until removed', async () => {
    const a = await seed(0, 12);
    const blocks = new ScheduleBlocksService(db as any);
    const closed: any = await blocks.createScheduleBlock(tenant.id, {
      type: 'FULL_DAY', blockDate: '2035-01-08', blockEndDate: '2035-01-10',
    } as any);
    expect(closed.startAt).toEqual(at(0));
    expect(closed.endAt).toEqual(new Date('2035-01-11T00:00:00Z'));
    expect(closed.affectedAppointments.map((item: any) => item.id)).toEqual([a.id]);
    const availability = new AvailabilityService(db as any);
    for (const date of ['2035-01-08', '2035-01-09', '2035-01-10']) {
      expect(await availability.getAvailabilityWithStatus(tenant.id, date, 'CAR', mode.id)).toMatchObject({ slots: [], closed: true });
    }
    await expect(create(1, new Date('2035-01-09T12:00:00Z'))).rejects.toMatchObject({ status: 400 });
    await expect(services[0].rescheduleAppointment(a.id, tenant.id, new Date('2035-01-10T12:00:00Z'))).rejects.toMatchObject({ status: 400 });
    expect((await db.appointment.findUnique({ where: { id: a.id } })).status).toBe('CONFIRMED');
    expect((await availability.getAvailabilityWithStatus(tenant.id, '2035-01-11', 'CAR', mode.id)).closed).toBe(false);
    await expect(blocks.deleteScheduleBlock(closed.id, 'foreign')).rejects.toMatchObject({ status: 404 });
    await blocks.deleteScheduleBlock(closed.id, tenant.id);
    await expect(create(1, new Date('2035-01-09T12:00:00Z'))).resolves.toBeDefined();
  });
  it('serializes closure against booking so a winning booking is included in the warning', async () => {
    const blocks = new ScheduleBlocksService(clients[2] as any);
    const [booking, closing] = await Promise.allSettled([create(0), blocks.createScheduleBlock(tenant.id, {
      type: 'FULL_DAY', blockDate: '2035-01-08', blockEndDate: '2035-01-08',
    } as any)]);
    expect(closing.status).toBe('fulfilled');
    const closure = (closing as PromiseFulfilledResult<any>).value;
    if (booking.status === 'fulfilled') expect(closure.affectedAppointments.map((a: any) => a.id)).toContain(booking.value.id);
    else expect(booking.reason.getStatus()).toBe(400);
    const listed: any[] = await blocks.getScheduleBlocksByBusiness(tenant.id);
    expect(listed[0].affectedAppointments).toHaveLength(booking.status === 'fulfilled' ? 1 : 0);
  });
  it('uses local calendar boundaries across daylight saving and excludes cancelled appointments', async () => {
    await db.business.update({ where: { id: tenant.id }, data: { timezone: 'America/New_York' } });
    const blocks = new ScheduleBlocksService(db as any);
    const closed: any = await blocks.createScheduleBlock(tenant.id, {
      type: 'FULL_DAY', blockDate: '2030-03-10', blockEndDate: '2030-03-11',
    } as any);
    expect(closed.startAt.toISOString()).toBe('2030-03-10T05:00:00.000Z');
    expect(closed.endAt.toISOString()).toBe('2030-03-12T04:00:00.000Z');
    const a = await seed(0, 12);
    await db.appointment.update({ where: { id: a.id }, data: { status: 'CANCELLED' } });
    const other: any = await blocks.createScheduleBlock(tenant.id, { type: 'FULL_DAY', blockDate: '2035-01-08' } as any);
    expect(other.affectedAppointments).toEqual([]);
  });
  it('commits admin events before delivery to the tenant admin', async () => {
    await db.user.update({ where: { id: users[1].id }, data: { role: 'ADMIN' } });
    const observed: any[] = [];
    notifications.sendToUser.mockImplementation(async (payload) => {
      observed.push({ payload,
        events: await db.notification.count({ where: { businessId: tenant.id, userId: payload.userId } }),
        appointments: await db.appointment.count({ where: { businessId: tenant.id } }),
      });
    });
    await create(0); await drain();
    expect(observed).toEqual([{ events: 1, appointments: 1, payload: expect.objectContaining({ businessId: tenant.id,
      userId: users[1].id, url: '/notifications', title: 'Novo agendamento recebido' }) }]);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });
  it('rolls back status, history and inserted notification if the transaction fails afterwards', async () => {
    const a = await seed(0, 12);
    notifications.createForUser.mockImplementationOnce(async (data, tx) => {
      await new NotificationsService(db as any).createForUser(data, tx);
      throw new Error('failure after internal event');
    });
    await expect(services[0].cancelAppointment(a.id, tenant.id, users[0].id, 'CUSTOMER')).rejects.toThrow('failure after internal event');
    expect((await db.appointment.findUnique({ where: { id: a.id } })).status).toBe('CONFIRMED');
    expect(await db.appointmentStatusHistory.count({ where: { appointmentId: a.id } })).toBe(0);
    expect(await db.notification.count({ where: { businessId: tenant.id } })).toBe(0);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });
  it('keeps committed cancellation and internal notice after provider failure, without retry', async () => {
    const a = await seed(0, 12);
    notifications.sendToUser.mockRejectedValue(new Error('provider unavailable'));
    await expect(services[0].cancelAppointment(a.id, tenant.id, users[0].id, 'CUSTOMER')).resolves.toMatchObject({ status: 'CANCELLED' });
    await drain();
    expect(await db.notification.count({ where: { appointmentId: a.id } })).toBe(1);
    await expect(services[1].cancelAppointment(a.id, tenant.id, users[0].id, 'CUSTOMER')).rejects.toBeDefined();
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });
  it('returns while external delivery is pending and releases the transaction lock', async () => {
    const a = await seed(0, 12);
    let release: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    notifications.sendToUser.mockReturnValue(hold);
    try {
      await services[0].startAppointment(a.id, tenant.id, users[0].id);
      await services[1].completeAppointment(a.id, tenant.id, users[0].id);
      expect(await db.notification.count({ where: { appointmentId: a.id } })).toBe(2);
    } finally { release(); await drain(); }
  });
  it('rejects invalid status order and concurrent repeated start/completion without duplicate events', async () => {
    const a = await seed(0, 12);
    await expect(services[0].completeAppointment(a.id, tenant.id, users[0].id)).rejects.toBeDefined();
    for (const action of ['startAppointment', 'completeAppointment'] as const) {
      const result = await Promise.allSettled(services.map((service) => service[action](a.id, tenant.id, users[0].id)));
      expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await drain();
    }
    const history = await db.appointmentStatusHistory.findMany({ where: { appointmentId: a.id }, orderBy: { changedAt: 'asc' } });
    expect(history.map((h) => [h.oldStatus, h.newStatus])).toEqual([['CONFIRMED', 'IN_PROGRESS'], ['IN_PROGRESS', 'COMPLETED']]);
    expect(await db.notification.count({ where: { appointmentId: a.id } })).toBe(2);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
  });
  it.each(['admin', 'customer'])('does not duplicate the same %s reschedule on retry', async (role) => {
    const a = await seed(0, 8);
    const reschedule = (service: AppointmentsService) => role === 'admin'
      ? service.rescheduleAppointment(a.id, tenant.id, at(12))
      : service.rescheduleCustomerAppointment(a.id, tenant.id, users[0].customerProfile.id, at(12));
    await Promise.all(services.map(reschedule)); await drain();
    expect(await db.notification.count({ where: { appointmentId: a.id } })).toBe(1);
    expect(await db.appointmentStatusHistory.count({ where: { appointmentId: a.id } })).toBe(1);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });
  it('skips an obsolete start push after completion and rejects a foreign tenant recipient', async () => {
    const a = await seed(0, 12);
    jest.spyOn(services[0] as any, 'dispatchAfterCommit').mockImplementation(() => {});
    const started = await services[0].startAppointment(a.id, tenant.id, users[0].id);
    const event = await db.notification.findFirst({ where: { appointmentId: a.id } });
    await services[1].completeAppointment(a.id, tenant.id, users[0].id); await drain();
    await (services[0] as any).dispatchCommittedEvent(event, started);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    await expect(new NotificationsService(db as any).createForUser({ businessId: 'foreign-tenant', userId: users[0].id,
      type: 'GENERAL', title: 'test', message: 'test' })).rejects.toMatchObject({ status: 404 });
    await expect(services[0].cancelAppointment(a.id, 'foreign-tenant', users[0].id, 'ADMIN')).rejects.toMatchObject({ status: 404 });
    expect(await db.notification.count({ where: { appointmentId: a.id } })).toBe(2);
  });
  it.each(['admin', 'customer'])('allows at most one of two simultaneous %s reschedules', async (role) => {
    const appointments = await Promise.all([seed(0, 8), seed(1, 9)]);
    const results = await Promise.allSettled(appointments.map((a, i) => role === 'admin'
      ? services[i].rescheduleAppointment(a.id, tenant.id, at(12))
      : services[i].rescheduleCustomerAppointment(a.id, tenant.id, users[i].customerProfile.id, at(12))));
    await expectOne(results);
    await drain();
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('coordinates creation against rescheduling', async () => {
    const a = await seed(0, 8);
    await expectOne(await Promise.allSettled([
      services[0].rescheduleAppointment(a.id, tenant.id, at(12)), create(1),
    ]));
  });
  it('rejects partial overlap for 40-minute services starting 15 minutes apart', async () => {
    const results = await Promise.allSettled([create(0), create(1, at(12, 15))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.appointment.count({ where: { businessId: tenant.id } })).toBe(1);
  });
  it('accepts adjacent variable-duration intervals', async () => {
    const results = await Promise.allSettled([create(0), create(1, at(12, 40))]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
  it('rechecks the persisted duration even if the current rule became shorter', async () => {
    const a = await seed(0, 8);
    await seed(1, 13);
    await db.serviceModeRule.update({ where: { id: rule.id }, data: { durationMinutes: 15 } });
    await expect(services[0].rescheduleAppointment(a.id, tenant.id, at(12, 30))).rejects.toMatchObject({ status: 400 });
    expect((await db.appointment.findUnique({ where: { id: a.id } })).scheduledStartAt).toEqual(at(8));
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });
  it('excludes itself when moving within its previous interval', async () => {
    const a = await seed(0, 12);
    const result = await services[0].rescheduleCustomerAppointment(a.id, tenant.id, users[0].customerProfile.id, at(12, 15));
    expect(result.scheduledEndAt).toEqual(at(12, 55));
  });
  it('releases cancelled capacity and refuses to revive a cancelled appointment', async () => {
    const a = await seed(0, 12);
    await services[0].cancelAppointment(a.id, tenant.id, users[0].id, 'CUSTOMER');
    await expect(create(1)).resolves.toMatchObject({ status: 'CONFIRMED' });
    await expect(services[0].rescheduleAppointment(a.id, tenant.id, at(14))).rejects.toMatchObject({ status: 400 });
  });
  it('serializes cancellation and starting so a stale read cannot restore cancelled capacity', async () => {
    const a = await seed(0, 12);
    const results = await Promise.allSettled([
      services[0].cancelAppointment(a.id, tenant.id, users[0].id, 'CUSTOMER'),
      services[1].startAppointment(a.id, tenant.id, users[1].id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.appointmentStatusHistory.count({ where: { appointmentId: a.id } })).toBe(1);
  });
  it('honors an active schedule block and releases capacity after deletion', async () => {
    const blocks = new ScheduleBlocksService(db as any);
    const block = await blocks.createScheduleBlock(tenant.id, {
      type: 'TIME_RANGE', blockDate: '2035-01-08', blockStartTime: '12:00', blockEndTime: '13:00', isRecurring: false,
    } as any);
    await expect(create(0)).rejects.toMatchObject({ status: 400 });
    await blocks.deleteScheduleBlock(block.id, tenant.id);
    await expect(create(0)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });
  it('reads a schedule block committed while the booking waits for the lock', async () => {
    let release: () => void;
    let signal: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { signal = resolve; });
    const writer = withScheduleTransaction(clients[2] as any, tenant.id, async (tx) => {
      await tx.scheduleBlock.create({ data: { businessId: tenant.id, type: 'TIME_RANGE', startAt: at(12), endAt: at(13) } });
      signal(); await hold;
    });
    await locked;
    const booking = Promise.allSettled([create(0)]);
    await pause(100);
    release(); await writer;
    const [result] = await booking;
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason.getStatus()).toBe(400);
    expect(await db.appointment.count({ where: { businessId: tenant.id } })).toBe(0);
  });
  it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const)('does not occupy capacity for %s', async (status) => {
    const a = await seed(0, 12);
    await db.appointment.update({ where: { id: a.id }, data: { status } });
    await expect(create(1)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });
  it('keeps IN_PROGRESS occupied and supports completion after starting', async () => {
    const a = await seed(0, 12);
    await services[0].startAppointment(a.id, tenant.id, users[0].id);
    await expect(create(1)).rejects.toMatchObject({ status: 400 });
    await services[0].completeAppointment(a.id, tenant.id, users[0].id);
    await expect(create(1)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });
  it('rolls back appointment writes on history failure and sends no notifications', async () => {
    // A real PostgreSQL constraint failure, not a mocked transaction result.
    const failing = new Proxy(clients[1], { get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key);
      return (work: any, options: any) => target.$transaction((tx) => work(new Proxy(tx, { get(t, k) {
        if (k !== 'appointmentStatusHistory') return Reflect.get(t, k);
        return { create: (args: any) => t.appointmentStatusHistory.create({ data: { ...args.data, appointmentId: 'missing-fixture' } }) };
      } })), options);
    } });
    services[0] = new AppointmentsService(failing as any, new AvailabilityService(failing as any), {} as any, notifications, notifications);
    await expect(create(0)).rejects.toMatchObject({ code: 'P2003' });
    expect(await db.appointment.count({ where: { businessId: tenant.id } })).toBe(0);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });
  it('preserves the 15-minute exploration step', async () => {
    const slots = await new AvailabilityService(db as any).getAvailableSlots(tenant.id, at(12), 'CAR', mode.id);
    expect(slots.slice(0, 3).map((s) => s.startTime)).toEqual(['06:00', '06:15', '06:30']);
    expect(slots[0].endTime).toBe('06:40');
  });
  it('uses the business timezone for the actual instant, independent of server timezone', async () => {
    await db.business.update({ where: { id: tenant.id }, data: { timezone: 'America/Sao_Paulo' } });
    // 08:00 UTC is 05:00 local, outside the 06:00 opening time.
    await expect(create(0, at(8))).rejects.toMatchObject({ status: 400 });
    await expect(create(0, at(9))).resolves.toMatchObject({ scheduledStartAt: at(9) });
  });
  it('does not serialize unrelated companies on the same row lock', async () => {
    const other = await db.business.create({ data: { name: 'Other fixture', slug: `other-${tenant.id}` } });
    let release: () => void;
    let locked: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let timer: ReturnType<typeof setTimeout>;
    const first = withScheduleTransaction(clients[1] as any, tenant.id, async () => { locked(); await hold; });
    try {
      await acquired;
      const result = await Promise.race([
        withScheduleTransaction(clients[2] as any, other.id, async () => 'independent'),
        new Promise<string>((resolve) => { timer = setTimeout(() => resolve('blocked'), 1500); }),
      ]);
      expect(result).toBe('independent');
    } finally {
      clearTimeout(timer);
      release(); await first; await db.business.delete({ where: { id: other.id } });
    }
  });
});
