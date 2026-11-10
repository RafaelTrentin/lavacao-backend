import { BadRequestException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtGuard } from 'src/common/guards/jwt.guard';
import { PushNotificationsController } from '../push-notifications/push-notifications.controller';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { FirebaseMessagingService } from '../push-notifications/firebase-messaging.service';

jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));

// Simulate Prisma selection against complete synthetic records, rather than
// returning already-sanitized fixtures that would hide a missing projection.
function project(row: any, query: any = {}): any {
  if (row == null) return row;
  if (Array.isArray(row)) return row.map((item) => project(item, query));
  const relations = ['user', 'addresses', 'refreshTokens', 'passwordResetTokens'];
  const result: Record<string, any> = query.select ? {} : Object.fromEntries(
    Object.entries(row).filter(([key]) => !relations.includes(key)),
  );
  for (const [key, selection] of Object.entries(query.select || query.include || {})) {
    if (!selection) continue;
    result[key] = relations.includes(key)
      ? project(row[key], selection === true ? {} : selection)
      : row[key];
  }
  return result;
}

const sensitive = new Set([
  'passwordHash', 'tokenVersion', 'token', 'accessToken', 'refreshToken',
  'refreshTokens', 'passwordResetTokens', 'tokenHash', 'revocationKeyHash',
  'revocationKey', 'endpoint', 'p256dh', 'auth', 'futureSecret',
]);
function expectSafe(value: any) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    expect(sensitive.has(key)).toBe(false);
    expectSafe(nested);
  }
}

describe('Customer and push HTTP response contracts (no database)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let rows: any[];
  let newUser: any;
  const prisma = {
    customerProfile: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn() },
    pushSubscription: { upsert: jest.fn() },
    $transaction: jest.fn(),
  };
  const sessions: Record<string, any> = {};
  for (const tenant of ['a', 'b']) {
    sessions[`customer-${tenant}`] = { userId: `user-${tenant}`, businessId: tenant, role: 'CUSTOMER' };
    sessions[`admin-${tenant}`] = { userId: `admin-${tenant}`, businessId: tenant, role: 'ADMIN' };
  }
  sessions.mismatch = { userId: 'user-b', businessId: 'a', role: 'CUSTOMER' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CustomersController, PushNotificationsController],
      providers: [
        CustomersService, PushNotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirebaseMessagingService, useValue: {} },
      ],
    }).overrideGuard(JwtGuard).useValue({
      canActivate(context: any) {
        const request = context.switchToHttp().getRequest();
        const user = sessions[request.headers['x-test-session']];
        if (!user) throw new UnauthorizedException();
        request.user = user;
        return true;
      },
    }).compile();
    // Only authentication is substituted; real AdminGuard, controllers, services
    // and the production ValidationPipe settings are exercised over local HTTP.
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
      exceptionFactory: (errors) => new BadRequestException(errors),
    }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    rows = ['a', 'b'].map((tenant) => ({
      id: `customer-${tenant}`, userId: `user-${tenant}`, businessId: tenant,
      name: `Customer ${tenant}`, phone: '00000000000', documentNumber: null,
      preferredContactMethod: 'WHATSAPP', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      user: {
        id: `user-${tenant}`, email: `${tenant}@example.test`, role: 'CUSTOMER', businessId: tenant,
        passwordHash: 'synthetic-hash', tokenVersion: 7, futureSecret: 'synthetic-future-secret',
        isActive: true, lastLoginAt: null, deletedAt: null,
        refreshTokens: [{ token: 'synthetic-refresh' }],
        passwordResetTokens: [{ tokenHash: 'synthetic-recovery-hash' }],
      },
      addresses: [{ id: `address-${tenant}`, businessId: tenant, customerId: `customer-${tenant}`,
        streetAddress: 'Test Street', number: '1', city: 'Test City', state: 'SC' }],
    }));
    const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
    prisma.customerProfile.findUnique.mockImplementation(async (query) =>
      project(rows.find((row) => matches(row, query.where)) || null, query));
    prisma.customerProfile.findMany.mockImplementation(async (query) =>
      project(rows.filter((row) => matches(row, query.where)), query));
    prisma.customerProfile.update.mockImplementation(async (query) => {
      const row = rows.find((item) => matches(item, query.where));
      if (!row) throw new Error('Unexpected update outside selected tenant');
      Object.assign(row, query.data);
      return project(row, query);
    });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async (query) => {
      newUser = { id: 'new-user', tokenVersion: 0, ...query.data };
      return project(newUser, query);
    });
    prisma.customerProfile.create.mockImplementation(async (query) => {
      const row = { id: 'new-customer', ...query.data, user: newUser, addresses: [] };
      rows.push(row);
      return project(row, query);
    });
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    prisma.pushSubscription.upsert.mockImplementation(async (query) =>
      project({ id: 'subscription-test', ...query.create, createdAt: '2026-01-01', updatedAt: '2026-01-01' }, query));
  });
  afterAll(async () => { await app?.close(); });

  async function request(method: string, path: string, session: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-test-session': session },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  function expectCustomer(body: any, tenant: string) {
    expectSafe(body);
    expect(body.businessId).toBe(tenant);
    expect(body.name).toEqual(expect.any(String));
    expect(body.phone).toEqual(expect.any(String));
    expect(Object.keys(body.user).sort()).toEqual(['businessId', 'email', 'id', 'role']);
    expect(body.user.businessId).toBe(tenant);
    expect(body.user.email).toEqual(expect.any(String));
    expect(Array.isArray(body.addresses)).toBe(true);
    for (const address of body.addresses) expect(address.businessId).toBe(tenant);
  }

  describe.each(['a', 'b'])('business %s', (tenant) => {
    it('returns only the authenticated customer profile and public user fields', async () => {
      const result = await request('GET', '/customers/profile', `customer-${tenant}`);
      expect(result.status).toBe(200);
      expectCustomer(result.body, tenant);
      expect(result.body.id).toBe(`customer-${tenant}`);
      expect(result.body.addresses[0].streetAddress).toBe('Test Street');
    });
    it('returns an administrative list isolated by business', async () => {
      const result = await request('GET', '/customers/admin/list', `admin-${tenant}`);
      expect(result.status).toBe(200);
      expect(result.body).toHaveLength(1);
      expectCustomer(result.body[0], tenant);
      expect(result.body[0].id).toBe(`customer-${tenant}`);
    });
    it('updates the own profile without returning internal fields', async () => {
      const result = await request('PUT', '/customers/profile', `customer-${tenant}`, { name: 'Updated Customer' });
      expect(result.status).toBe(200);
      expectCustomer(result.body, tenant);
      expect(result.body.name).toBe('Updated Customer');
      expect(rows.find((row) => row.businessId !== tenant).name).not.toBe('Updated Customer');
    });
    it('creates a quick customer in the administrator business with a safe response', async () => {
      const result = await request('POST', '/customers/admin/quick', `admin-${tenant}`, {
        name: 'New Customer', phone: '00000000000', email: 'new@example.test',
      });
      expect(result.status).toBe(201);
      expectCustomer(result.body, tenant);
      expect(result.body.user.email).toBe('new@example.test');
      expect(newUser.businessId).toBe(tenant);
      expect(newUser.role).toBe('CUSTOMER');
    });
    it('registers push without returning the subscription endpoint or keys', async () => {
      const result = await request('POST', '/push-notifications/subscribe', `customer-${tenant}`, {
        endpoint: 'https://push.example.test/subscription', keys: { p256dh: 'synthetic-key', auth: 'synthetic-auth' },
      });
      expect(result.status).toBe(201);
      expectSafe(result.body);
      expect(result.body).toMatchObject({ id: 'subscription-test', businessId: tenant, userId: `user-${tenant}` });
      expect(prisma.pushSubscription.upsert.mock.calls[0][0].create).toMatchObject({
        businessId: tenant, userId: `user-${tenant}`, p256dh: 'synthetic-key', auth: 'synthetic-auth',
      });
    });
  });

  it.each(['GET', 'PUT'])('rejects cross-business profile access via %s', async (method) => {
    const result = await request(method, '/customers/profile', 'mismatch', method === 'PUT' ? { name: 'Invalid Update' } : undefined);
    expect(result.status).toBe(404);
    expectSafe(result.body);
    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
  });
  it('also rejects another business when reading directly through the service', async () => {
    await expect(app.get(CustomersService).getProfile('a', 'customer-b'))
      .rejects.toThrow('Cliente não encontrado');
  });
  it('also rejects another business when updating directly through the service', async () => {
    await expect(app.get(CustomersService).updateProfile('a', 'customer-b', { name: 'Invalid Update' }))
      .rejects.toThrow('Cliente não encontrado');
    expect(prisma.customerProfile.update).not.toHaveBeenCalled();
  });
  it.each([
    ['GET', '/customers/admin/list'], ['POST', '/customers/admin/quick'],
  ])('denies customer access to %s %s', async (method, path) => {
    expect((await request(method, path, 'customer-a', method === 'POST' ? {} : undefined)).status).toBe(403);
    expect(prisma.customerProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
  it('does not accept a client-supplied businessId when creating a quick customer', async () => {
    expect((await request('POST', '/customers/admin/quick', 'admin-a', {
      name: 'Test', phone: '00000000000', businessId: 'b',
    })).status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
  it('requires authentication to read profiles', async () => {
    expect((await request('GET', '/customers/profile', 'anonymous')).status).toBe(401);
    expect(prisma.customerProfile.findUnique).not.toHaveBeenCalled();
  });
});
