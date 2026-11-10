import { INestApplication, ValidationPipe, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from './modules/prisma/prisma.service';
import { JwtStrategy } from './modules/auth/jwt.strategy';
import { AdminGuard } from './common/guards/admin.guard';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { AddressesController } from './modules/addresses/addresses.controller';
import { AddressesService } from './modules/addresses/addresses.service';
import { AppointmentsController } from './modules/appointments/appointments.controller';
import { AppointmentsService } from './modules/appointments/appointments.service';
import { AvailabilityController } from './modules/availability/availability.controller';
import { AvailabilityService } from './modules/availability/availability.service';
import { BusinessController } from './modules/business/business.controller';
import { PublicBusinessController } from './modules/business/public-business.controller';
import { BusinessService } from './modules/business/business.service';
import { CustomersController } from './modules/customers/customers.controller';
import { CustomersService } from './modules/customers/customers.service';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { ExtraServicesController } from './modules/extra-services/extra-services.controller';
import { ExtraServicesService } from './modules/extra-services/extra-services.service';
import { MapsController } from './modules/maps/maps.controller';
import { MapsService } from './modules/maps/maps.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { NotificationsService } from './modules/notifications/notifications.service';
import { PushNotificationsController } from './modules/push-notifications/push-notifications.controller';
import { PushDeviceRevocationController } from './modules/push-notifications/push-device-revocation.controller';
import { PushNotificationsService } from './modules/push-notifications/push-notifications.service';
import { FirebaseMessagingService } from './modules/push-notifications/firebase-messaging.service';
import { ScheduleBlocksController } from './modules/schedule-blocks/schedule-blocks.controller';
import { ScheduleBlocksService } from './modules/schedule-blocks/schedule-blocks.service';
import { ServiceModesController } from './modules/service-modes/service-modes.controller';
import { ServiceModesService } from './modules/service-modes/service-modes.service';
import { VehicleTypesController } from './modules/vehicle-types/vehicle-types.controller';
import { VehicleTypesService } from './modules/vehicle-types/vehicle-types.service';
import { MailService } from './modules/mail/mail.service';

jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), { virtual: true });
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));

const controllers = [AuthController, AddressesController, AppointmentsController, AvailabilityController,
  BusinessController, PublicBusinessController, CustomersController, DashboardController, ExtraServicesController,
  MapsController, NotificationsController, PushNotificationsController, PushDeviceRevocationController,
  ScheduleBlocksController, ServiceModesController, VehicleTypesController];
const publicControllers = [AuthController, PublicBusinessController, PushDeviceRevocationController];
const routes = controllers.flatMap((controller) => Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
  const handler = controller.prototype[name];
  const method = Reflect.getMetadata(METHOD_METADATA, handler);
  if (method === undefined) return [];
  const path = '/' + [Reflect.getMetadata(PATH_METADATA, controller), Reflect.getMetadata(PATH_METADATA, handler)]
    .filter((part) => part && part !== '/').join('/');
  const guards = [...(Reflect.getMetadata(GUARDS_METADATA, controller) || []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) || [])];
  return [{ method: RequestMethod[method], path: path.replace(/:[^/]+/g, 'foreign-id'),
    private: !publicControllers.includes(controller as any), admin: guards.includes(AdminGuard) }];
}));

// Real controllers/services, DTOs, Passport/JwtStrategy and AdminGuard. Prisma
// and integrations are isolated doubles; AppModule/.env are never loaded.
describe('Tenant HTTP boundaries', () => {
  let app: INestApplication;
  let url: string;
  let jwt: JwtService;
  let appointments: AppointmentsService;
  let availability: AvailabilityService;
  let push: PushNotificationsService;
  let rows: Record<string, any[]>;
  const previousSecret = process.env.JWT_SECRET;
  const secret = 'isolated-test-signing-secret-not-for-production';
  const models = ['user', 'business', 'customerProfile', 'appointment', 'address', 'serviceMode', 'serviceModeRule',
    'vehicleType', 'scheduleBlock', 'extraService', 'extraServiceRequest', 'notification', 'pushSubscription', 'pushDevice'];
  const prisma: any = Object.fromEntries(models.map((model) => [model, Object.fromEntries(
    ['findUnique', 'findFirst', 'findMany', 'create', 'update', 'updateMany', 'deleteMany', 'upsert', 'count'].map((op) => [op, jest.fn()]),
  )]));
  const writes = () => models.flatMap((model) => ['create', 'update', 'updateMany', 'deleteMany', 'upsert'].map((op) => prisma[model][op]));
  const matches = (row: any, where: any): boolean => !!row && Object.entries(where || {}).every(([key, value]: [string, any]) => {
    if (value === undefined) return true;
    if (key === 'OR') return value.some((condition: any) => matches(row, condition));
    if (key === 'AND') return value.every((condition: any) => matches(row, condition));
    if (value && typeof value === 'object' && !(value instanceof Date)) return matches(row[key], value);
    return row[key] === value;
  });
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret }), ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }])],
      controllers,
      providers: [JwtStrategy, AuthService, AddressesService, AppointmentsService, AvailabilityService, BusinessService,
        CustomersService, DashboardService, ExtraServicesService, NotificationsService, PushNotificationsService,
        ScheduleBlocksService, ServiceModesService, VehicleTypesService,
        { provide: PrismaService, useValue: prisma }, { provide: MailService, useValue: {} },
        { provide: MapsService, useValue: { geocodeAddress: jest.fn() } },
        { provide: FirebaseMessagingService, useValue: { isAvailable: () => false } }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    jwt = module.get(JwtService);
    appointments = module.get(AppointmentsService);
    availability = module.get(AvailabilityService);
    push = module.get(PushNotificationsService);
    await app.listen(0, '127.0.0.1'); url = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close(); jest.restoreAllMocks();
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    rows = Object.fromEntries(models.map((model) => [model, []]));
    rows.business = ['a', 'b'].map((id) => ({ id, slug: `wash-${id}`, isActive: true, deletedAt: null,
      settings: { operatingHours: {} }, businessAddress: { latitude: { toNumber: () => 0 }, longitude: { toNumber: () => 0 } },
    }));
    rows.user = ['admin-a', 'customer-a', 'other-a', 'admin-b', 'customer-b'].map((id) => ({
      id, email: `${id}@example.test`, role: id.startsWith('admin') ? 'ADMIN' : 'CUSTOMER',
      businessId: id.endsWith('a') ? 'a' : 'b', isActive: true, deletedAt: null, tokenVersion: 0,
      business: rows.business.find((b) => b.id === id.slice(-1)),
    }));
    rows.customerProfile = ['a', 'b', 'other-a'].map((id) => ({ id: `customer-${id}`, userId: id === 'other-a' ? id : `customer-${id}`, businessId: id === 'b' ? 'b' : 'a' }));
    for (const model of ['appointment', 'address', 'serviceMode', 'vehicleType', 'scheduleBlock', 'extraService', 'extraServiceRequest', 'notification']) {
      rows[model] = ['a', 'b', 'other-a', 'deleted-a'].map((id) => ({
        id, businessId: id === 'b' ? 'b' : 'a', customerId: `customer-${id === 'deleted-a' ? 'a' : id}`,
        userId: `customer-${id}`, name: `private-${id}`, isActive: true, kind: 'CAR',
        deletedAt: id === 'deleted-a' ? new Date() : null, status: 'CONFIRMED',
      }));
    }
    rows.serviceModeRule = ['a', 'b'].map((id) => ({ id, serviceMode: rows.serviceMode.find((r) => r.id === id), vehicleType: rows.vehicleType.find((r) => r.id === id) }));
    rows.appointment.forEach((a) => { a.customer = rows.customerProfile.find((c) => c.id === a.customerId); });
    for (const model of models) {
      prisma[model].findUnique.mockImplementation(async ({ where }: any) => rows[model].find((r) => matches(r, where)) || null);
      prisma[model].findFirst.mockImplementation(async ({ where }: any) => rows[model].find((r) => matches(r, where)) || null);
      prisma[model].findMany.mockImplementation(async ({ where }: any) => rows[model].filter((r) => matches(r, where)));
      prisma[model].update.mockImplementation(async ({ where, data }: any) => {
        const row = rows[model].find((r) => matches(r, where));
        if (!row) throw new Error('unexpected update');
        Object.entries(data).forEach(([key, value]) => { if (value !== undefined) row[key] = value; });
        return row;
      });
      prisma[model].deleteMany.mockImplementation(async ({ where }: any) => {
        const previous = rows[model].length;
        rows[model] = rows[model].filter((row) => !matches(row, where));
        return { count: previous - rows[model].length };
      });
    }
  });
  async function request(method: string, path: string, userId?: string, body?: unknown, claims = {}) {
    const response = await fetch(`${url}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(userId ? {
        Authorization: `Bearer ${jwt.sign({ sub: userId, tokenVersion: 0, ...claims }, { expiresIn: '5m' })}`,
      } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it('inventories all 81 HTTP handlers and rejects anonymous access to every private handler', async () => {
    expect(routes).toHaveLength(81);
    for (const route of routes.filter((r) => r.private)) {
      expect((await request(route.method, route.path)).status).toBe(401);
    }
  });
  it.each(['inactive-user', 'deleted-user', 'inactive-business', 'deleted-business', 'old-version'])('rejects %s at every private HTTP handler', async (state) => {
    const user = rows.user[0];
    if (state === 'inactive-user') user.isActive = false;
    if (state === 'deleted-user') user.deletedAt = new Date();
    if (state === 'inactive-business') user.business.isActive = false;
    if (state === 'deleted-business') user.business.deletedAt = new Date();
    if (state === 'old-version') user.tokenVersion = 1;
    for (const route of routes.filter((r) => r.private)) expect((await request(route.method, route.path, user.id)).status).toBe(401);
    writes().forEach((write) => expect(write).not.toHaveBeenCalled());
  });
  it('uses the database role instead of ADMIN in claims for every administrative handler', async () => {
    for (const route of routes.filter((r) => r.admin)) {
      expect((await request(route.method, route.path, 'customer-a', undefined, { role: 'ADMIN', businessId: 'b' })).status).toBe(403);
    }
  });
  it('uses the database tenant instead of JWT/query claims in list requests', async () => {
    const result = await request('GET', '/addresses?businessId=b', 'customer-a', undefined, { businessId: 'b' });
    expect(result.status).toBe(200);
    expect(result.body.map((r: any) => r.id)).toEqual(['a']);
    expect(prisma.address.findMany).toHaveBeenCalledWith({ where: { businessId: 'a', customerId: 'customer-a', deletedAt: null } });
  });

  const foreign = [
    ['GET', '/appointments/b', 'customer-a', undefined],
    ['GET', '/appointments/b', 'admin-a', undefined],
    ['POST', '/appointments/b/cancel', 'customer-a', {}],
    ['POST', '/appointments/b/reschedule', 'customer-a', { newScheduledStartAt: '2099-01-01T12:00:00Z' }],
    ['POST', '/appointments/b/start', 'admin-a', {}],
    ['POST', '/appointments/b/complete', 'admin-a', {}],
    ['POST', '/appointments/admin', 'admin-a', { customerId: 'customer-b', appointment: { serviceModeId: 'a', vehicleType: 'CAR', scheduledStartAt: '2099-01-01T12:00:00Z', willSearchVehicle: false } }],
    ['DELETE', '/addresses/b', 'customer-a', undefined],
    ['GET', '/service-modes/b', 'customer-a', undefined],
    ['PUT', '/admin/service-modes/b', 'admin-a', { name: 'test' }],
    ['DELETE', '/admin/service-modes/b', 'admin-a', undefined],
    ['POST', '/admin/service-modes/b/rules', 'admin-a', { vehicleTypeKind: 'CAR', durationMinutes: 30, basePriceInCents: 100 }],
    ['PUT', '/admin/service-modes/rules/b', 'admin-a', { durationMinutes: 30, basePriceInCents: 100 }],
    ['PUT', '/admin/vehicle-types/b', 'admin-a', { displayName: 'test' }],
    ['DELETE', '/admin/vehicle-types/b', 'admin-a', undefined],
    ['PUT', '/extra-services/b', 'admin-a', { name: 'test' }],
    ['DELETE', '/extra-services/b', 'admin-a', undefined],
    ['PUT', '/extra-services/requests/b/status', 'admin-a', { status: 'COMPLETED' }],
    ['POST', '/notifications/b/read', 'customer-a', {}],
    ['PUT', '/admin/schedule-blocks/b', 'admin-a', { reason: 'test' }],
    ['DELETE', '/admin/schedule-blocks/b', 'admin-a', undefined],
  ] as const;
  it.each(foreign)('denies cross-tenant %s %s (%s)', async (method, path, user, body) => {
    const result = await request(method, path, user, body);
    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).not.toContain('private-b');
    writes().forEach((write) => expect(write).not.toHaveBeenCalled());
  });
  it.each(['/appointments/other-a', '/addresses/other-a', '/notifications/other-a/read'])('denies another customer in the same business: %s', async (path) => {
    const method = path.startsWith('/addresses') ? 'DELETE' : path.startsWith('/notifications') ? 'POST' : 'GET';
    expect((await request(method, path, 'customer-a')).status).toBe(404);
    writes().forEach((write) => expect(write).not.toHaveBeenCalled());
  });
  it.each([{ businessId: 'b' }, { business: { connect: { id: 'b' } } }, { id: 'b' }, { deletedAt: null }, { business: { update: { name: 'changed' } } }])('rejects schedule-block mass assignment %#', async (body) => {
    expect((await request('PUT', '/admin/schedule-blocks/a', 'admin-a', body)).status).toBe(400);
    expect(prisma.scheduleBlock.update).not.toHaveBeenCalled();
    expect(rows.scheduleBlock[0].businessId).toBe('a');
  });
  it('preserves legitimate block edits and scopes the write itself', async () => {
    expect((await request('PUT', '/admin/schedule-blocks/a', 'admin-a', { reason: 'maintenance', isActive: false })).status).toBe(200);
    expect(rows.scheduleBlock[0]).toMatchObject({ businessId: 'a', reason: 'maintenance', isActive: false });
    expect(prisma.scheduleBlock.update.mock.calls[0][0].where).toEqual({ id: 'a', businessId: 'a', deletedAt: null });
  });
  it.each([
    ['GET', '/appointments/deleted-a'], ['POST', '/appointments/deleted-a/start'],
    ['PUT', '/admin/schedule-blocks/deleted-a'], ['DELETE', '/admin/schedule-blocks/deleted-a'],
  ])('rejects excluded records: %s %s', async (method, path) => {
    expect((await request(method, path, 'admin-a', method === 'PUT' ? { reason: 'test' } : undefined)).status).toBe(404);
    writes().forEach((write) => expect(write).not.toHaveBeenCalled());
  });

  it.each(['b', 'other-a', 'deleted-a'])('rejects saved address %s during creation and fee estimation', async (addressId) => {
    const dto = { serviceModeId: 'a', vehicleType: 'CAR', willSearchVehicle: true, searchType: 'MANUAL_ADDRESS' as any, serviceAddressId: addressId };
    await expect(appointments.createAppointment('a', 'customer-a', 'customer-a', { ...dto, scheduledStartAt: '2099-01-01T12:00:00Z' })).rejects.toThrow('Endereço inválido');
    await expect(appointments.estimateSearchFee('a', 'customer-a', dto)).rejects.toThrow('Endereço inválido');
    writes().forEach((write) => expect(write).not.toHaveBeenCalled());
  });
  it.each(['inactive-mode', 'deleted-mode', 'deleted-vehicle', 'foreign-vehicle'])('excludes operational rule %s from slots, validation and estimates', async (state) => {
    if (state === 'inactive-mode') rows.serviceMode[0].isActive = false;
    if (state === 'deleted-mode') rows.serviceMode[0].deletedAt = new Date();
    if (state === 'deleted-vehicle') rows.vehicleType[0].deletedAt = new Date();
    if (state === 'foreign-vehicle') rows.vehicleType[0].businessId = 'b';
    await expect(availability.getAvailableSlots('a', new Date('2099-01-01T12:00:00Z'), 'CAR', 'a')).rejects.toThrow('Modalidade não disponível');
    expect(await availability.validateSlotAvailability('a', new Date('2099-01-01T12:00:00Z'), '12:00', 'CAR', 'a')).toBe(false);
    await expect(appointments.estimateSearchFee('a', 'customer-a', { serviceModeId: 'a', vehicleType: 'CAR', willSearchVehicle: false })).rejects.toThrow('Modalidade não disponível');
  });
  it('rejects creating an appointment with a deleted mode', async () => {
    await expect(appointments.createAppointment('a', 'customer-a', 'customer-a', {
      serviceModeId: 'deleted-a', vehicleType: 'CAR', willSearchVehicle: false, scheduledStartAt: '2099-01-01T12:00:00Z',
    })).rejects.toThrow('Modalidade inválida');
  });
  it.each(['inactive-user', 'deleted-user', 'inactive-business', 'deleted-business', 'foreign-user'])('does not send push to %s', async (state) => {
    const user = rows.user.find((u) => u.id === 'customer-a');
    if (state === 'inactive-user') user.isActive = false;
    if (state === 'deleted-user') user.deletedAt = new Date();
    if (state === 'inactive-business') user.business.isActive = false;
    if (state === 'deleted-business') user.business.deletedAt = new Date();
    await push.sendToUser({ userId: state === 'foreign-user' ? 'customer-b' : user.id, businessId: 'a', title: 'test', body: 'test' });
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(prisma.pushDevice.findMany).not.toHaveBeenCalled();
  });
  it('keeps legitimate push lookup restricted to the active recipient and tenant', async () => {
    await push.sendToUser({ userId: 'customer-a', businessId: 'a', title: 'test', body: 'test' });
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({ where: { userId: 'customer-a', businessId: 'a' } });
  });
  it('rejects subscription takeover without matching keys; preserves same-browser account switching', async () => {
    const existing = { endpoint: 'https://push.example.test/subscription', userId: 'customer-b', businessId: 'b', p256dh: 'fixture-key', auth: 'fixture-auth' };
    prisma.pushSubscription.upsert.mockImplementation(async ({ where, update }: any) => {
      if (!matches(existing, where)) throw { code: 'P2002' };
      Object.assign(existing, update);
      return { id: 'subscription-test', userId: existing.userId, businessId: existing.businessId };
    });
    const rejected = await request('POST', '/push-notifications/subscribe', 'customer-a', {
      endpoint: existing.endpoint, keys: { p256dh: 'wrong', auth: 'wrong' },
    });
    expect(rejected.status).toBe(409);
    expect(existing.businessId).toBe('b');
    expect(JSON.stringify(rejected.body)).not.toContain('fixture-auth');
    const accepted = await request('POST', '/push-notifications/subscribe', 'customer-a', {
      endpoint: existing.endpoint, expirationTime: null, keys: { p256dh: 'fixture-key', auth: 'fixture-auth' },
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toEqual({ id: 'subscription-test', userId: 'customer-a', businessId: 'a' });
  });
  it.each([{}, { p256dh: 'key' }, { p256dh: '', auth: '' }])('rejects absent/empty push proof %#', async (keys) => {
    expect((await request('POST', '/push-notifications/subscribe', 'customer-a', { endpoint: 'https://push.example.test/subscription', keys })).status).toBe(400);
    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
  });
  it('prevents body tenant injection into new addresses', async () => {
    expect((await request('POST', '/addresses', 'customer-a', {
      businessId: 'b', customerId: 'customer-b', streetAddress: 'Test', number: '1', neighborhood: 'Test', city: 'Test', state: 'SC', zipCode: '00000000',
    })).status).toBe(400);
    expect(prisma.address.create).not.toHaveBeenCalled();
  });
  it('does not expose, remove or reassign another tenant device by its token', async () => {
    const token = 'foreign-device-test-token';
    rows.pushDevice = [{ id: 'foreign-device', token, userId: 'customer-b', businessId: 'b', isActive: true, platform: 'ANDROID' }];
    const status = await request('POST', '/push-notifications/devices/status', 'customer-a', { token });
    expect(status).toEqual({ status: 201, body: { registered: false, platform: null } });
    expect((await request('DELETE', '/push-notifications/devices', 'customer-a', { token })).body).toEqual({ success: true });
    expect(rows.pushDevice).toHaveLength(1);
    const register = await request('POST', '/push-notifications/devices', 'customer-a', { token, platform: 'ANDROID' });
    expect(register.status).toBe(409);
    expect(prisma.pushDevice.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(register.body)).not.toContain('customer-b');
  });
  it('does not remove another tenant Web Push subscription by endpoint', async () => {
    const endpoint = 'https://push.example.test/foreign';
    rows.pushSubscription = [{ endpoint, userId: 'customer-b', businessId: 'b' }];
    expect((await request('DELETE', '/push-notifications/unsubscribe', 'customer-a', { endpoint })).body).toEqual({ count: 0 });
    expect(rows.pushSubscription).toHaveLength(1);
  });
  it('allows unauthenticated device revocation only with its secret and returns no existence information', async () => {
    const revocationKey = 'isolated-revocation-test-key-'.repeat(2);
    rows.pushDevice = [{ id: 'device-b', businessId: 'b', revocationKeyHash: createHash('sha256').update(revocationKey).digest('hex') }];
    const wrong = await request('POST', '/push-notifications/devices/revoke', undefined, { revocationKey: 'wrong-test-key-'.repeat(4) });
    expect(rows.pushDevice).toHaveLength(1);
    const valid = await request('POST', '/push-notifications/devices/revoke', undefined, { revocationKey });
    expect(rows.pushDevice).toHaveLength(0);
    expect(valid).toEqual(wrong);
    expect(valid.body).toEqual({ success: true });
  });
  it('keeps public company lookup limited to available companies and public fields', async () => {
    const result = await request('GET', '/public/business/empresa/wash-b');
    expect(result.status).toBe(200);
    expect(result.body.id).toBe('b');
    expect(result.body).not.toHaveProperty('users');
    expect(result.body).not.toHaveProperty('settings');
    rows.business[1].isActive = false;
    expect((await request('GET', '/public/business/empresa/wash-b')).status).toBe(404);
    rows.business[1].isActive = true;
    rows.business[1].deletedAt = new Date();
    expect((await request('GET', '/public/business/empresa/wash-b')).status).toBe(404);
  });
  it('rejects a request for an extra service owned by another company', async () => {
    expect((await request('POST', '/extra-services/requests', 'customer-a', { extraServiceId: 'b' })).status).toBe(400);
    expect(prisma.extraServiceRequest.create).not.toHaveBeenCalled();
  });
});
