import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

// HTTP contract with real authentication/hashing and in-memory persistence.
// Does not load AppModule, .env, external services or a database connection.
describe('Login tenant selection (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let passwordHash: string;
  let otherHash: string;
  let users: any[];
  let businesses: any[];
  const email = 'admin@example.test';
  const password = 'isolated-admin-password';
  const generic = 'Não foi possível entrar. Confira suas credenciais ou selecione a lavação e entre pela tela dela.';
  const prisma = {
    business: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    refreshToken: { updateMany: jest.fn(), create: jest.fn() },
  };
  const jwt = { sign: jest.fn() };

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 4);
    otherHash = await bcrypt.hash('other-company-password', 4);
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: MailService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    businesses = ['a', 'b'].map((id) => ({ id, slug: `wash-${id}`, isActive: true, deletedAt: null }));
    users = businesses.map((b) => ({
      id: `admin-${b.id}`, email, passwordHash, role: 'ADMIN', businessId: b.id,
      isActive: true, deletedAt: null, tokenVersion: 0,
    }));
    const matches = (row: any, where: any): boolean => !!row && Object.entries(where).every(([key, value]) =>
      key === 'business'
        ? matches(businesses.find((b) => b.id === row.businessId), value)
        : row[key] === value);
    prisma.business.findFirst.mockImplementation(async ({ where }) => businesses.find((b) => matches(b, where)) || null);
    prisma.user.findFirst.mockImplementation(async ({ where }) => users.find((u) => matches(u, where)) || null);
    prisma.user.findMany.mockImplementation(async ({ where, take }) => users.filter((u) => matches(u, where)).slice(0, take));
    prisma.user.findUnique.mockImplementation(async ({ where }) => users.find((u) => u.id === where.id));
    jwt.sign.mockReturnValue('isolated-test-token');
  });

  afterAll(async () => { await app?.close(); });

  async function login(overrides: Record<string, unknown> = {}) {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...overrides }),
    });
    return { status: response.status, body: await response.json() };
  }

  function expectDenied(response: any, message = generic) {
    expect(response).toEqual({ status: 401, body: { statusCode: 401, error: 'Unauthorized', message } });
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  }

  it.each([false, true])('rejects multiple admins regardless of passwords or row order (different passwords: %s)', async (different) => {
    if (different) users[1].passwordHash = otherHash;
    expectDenied(await login());
    users.reverse();
    expectDenied(await login());
  });

  it.each(['a', 'b'])('issues tokens only for the explicitly selected business %s', async (id) => {
    const response = await login({ businessSlug: ` WASH-${id.toUpperCase()} `, email: 'ADMIN@EXAMPLE.TEST' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ accessToken: 'isolated-test-token', refreshToken: 'isolated-test-token', expiresIn: 86400, tokenType: 'Bearer' });
    expect(jwt.sign).toHaveBeenCalledTimes(2);
    for (const [payload] of jwt.sign.mock.calls) {
      expect(payload).toMatchObject({ sub: `admin-${id}`, businessId: id, role: 'ADMIN' });
    }
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: `admin-${id}` }, data: { lastLoginAt: expect.any(Date) } });
  });

  it('never falls back to another business when the selected account password differs', async () => {
    users[1].passwordHash = otherHash;
    expectDenied(await login({ businessSlug: 'wash-b' }), 'Credenciais inválidas');
  });

  it.each([undefined, null, '', '   '])('preserves a unique eligible administrator without context (%s)', async (businessSlug) => {
    users.pop();
    expect((await login({ businessSlug })).status).toBe(201);
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'admin-a', businessId: 'a', role: 'ADMIN' }), expect.any(Object));
  });

  it.each(['user-inactive', 'user-deleted', 'business-inactive', 'business-deleted', 'customer'])('ignores an ineligible second account: %s', async (kind) => {
    if (kind === 'user-inactive') users[1].isActive = false;
    if (kind === 'user-deleted') users[1].deletedAt = new Date();
    if (kind === 'business-inactive') businesses[1].isActive = false;
    if (kind === 'business-deleted') businesses[1].deletedAt = new Date();
    if (kind === 'customer') users[1].role = 'CUSTOMER';
    expect((await login()).status).toBe(201);
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'admin-a', businessId: 'a' }), expect.any(Object));
  });

  it.each(['user-inactive', 'user-deleted', 'business-inactive', 'business-deleted'])('rejects an unavailable sole account, with and without slug: %s', async (kind) => {
    users.pop();
    if (kind === 'user-inactive') users[0].isActive = false;
    if (kind === 'user-deleted') users[0].deletedAt = new Date();
    if (kind === 'business-inactive') businesses[0].isActive = false;
    if (kind === 'business-deleted') businesses[0].deletedAt = new Date();
    expectDenied(await login());
    expectDenied(await login({ businessSlug: 'wash-a' }), 'Credenciais inválidas');
  });

  it('returns the same public failure for unknown email, wrong password and ambiguous email', async () => {
    expectDenied(await login());
    expectDenied(await login({ email: 'unknown@example.test' }));
    users.pop();
    expectDenied(await login({ password: 'invalid-test-password' }));
  });

  it('does not promote a customer or allow customer login without business context', async () => {
    users = [{ ...users[0], role: 'CUSTOMER' }];
    expectDenied(await login());
    expect((await login({ businessSlug: 'wash-a' })).status).toBe(201);
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ role: 'CUSTOMER', businessId: 'a' }), expect.any(Object));
  });

  it('does not fall back to admin discovery for an unknown slug', async () => {
    users.pop();
    expectDenied(await login({ businessSlug: 'missing-wash' }), 'Credenciais inválidas');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
