import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { CustomersService } from './customers.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

// Real customer/auth services and hashing, in-memory persistence and mail only.
// No AppModule, .env, database connection or network request is used.
describe('Quick customer credentials and existing password recovery', () => {
  let customers: CustomersService;
  let auth: AuthService;
  let users: any[];
  let resets: any[];
  const businesses = [
    { id: 'a', slug: 'wash-a', isActive: true, deletedAt: null },
    { id: 'b', slug: 'wash-b', isActive: true, deletedAt: null },
  ];
  const mail = { sendPasswordResetEmail: jest.fn() };
  const jwt = { sign: jest.fn().mockReturnValue('isolated-token') };
  const prisma = {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    customerProfile: { create: jest.fn() },
    business: { findFirst: jest.fn() },
    passwordResetToken: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    refreshToken: { updateMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const previousResetUrl = process.env.PASSWORD_RESET_URL;
  const contact = { name: 'Test Customer', phone: '00000000000' };

  beforeAll(() => { process.env.PASSWORD_RESET_URL = 'https://example.test/redefinir-senha'; });
  afterAll(() => {
    if (previousResetUrl === undefined) delete process.env.PASSWORD_RESET_URL;
    else process.env.PASSWORD_RESET_URL = previousResetUrl;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    users = [];
    resets = [];
    const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
    prisma.user.findFirst.mockImplementation(async ({ where }) => users.find((u) => matches(u, where)) || null);
    prisma.user.findUnique.mockImplementation(async ({ where }) => users.find((u) => u.id === where.id) || null);
    prisma.user.create.mockImplementation(async ({ data }) => {
      const user = { id: `user-${users.length}`, tokenVersion: 0, deletedAt: null, ...data };
      users.push(user);
      return { id: user.id };
    });
    prisma.user.updateMany.mockImplementation(async ({ where, data }) => {
      const user = users.find((u) => u.id === where.id && u.isActive && u.deletedAt === null);
      if (!user) return { count: 0 };
      user.passwordHash = data.passwordHash;
      user.tokenVersion += data.tokenVersion.increment;
      return { count: 1 };
    });
    prisma.customerProfile.create.mockImplementation(async ({ data, select }) => {
      const user = users.find((u) => u.id === data.userId);
      return { id: 'profile-test', ...data, addresses: [], user: Object.fromEntries(
        Object.keys(select.user.select).map((key) => [key, user[key]]),
      ) };
    });
    prisma.business.findFirst.mockImplementation(async ({ where }) => businesses.find((b) => matches(b, where)) || null);
    prisma.passwordResetToken.findFirst.mockResolvedValue(null);
    prisma.passwordResetToken.create.mockImplementation(async ({ data }) => {
      const record = { id: `reset-${resets.length}`, usedAt: null, ...data };
      resets.push(record);
      return record;
    });
    prisma.passwordResetToken.findUnique.mockImplementation(async ({ where }) => resets.find((r) => r.tokenHash === where.tokenHash) || null);
    prisma.passwordResetToken.updateMany.mockImplementation(async ({ where, data }) => {
      const eligible = resets.filter((r) =>
        (!where.id || r.id === where.id) && (!where.userId || r.userId === where.userId) &&
        r.usedAt === null && (!where.expiresAt || r.expiresAt > where.expiresAt.gt));
      eligible.forEach((r) => Object.assign(r, data));
      return { count: eligible.length };
    });
    prisma.passwordResetToken.deleteMany.mockImplementation(async ({ where }) => {
      resets = resets.filter((r) => r.id !== where.id);
    });
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    mail.sendPasswordResetEmail.mockResolvedValue(undefined);
    customers = new CustomersService(prisma as unknown as PrismaService);
    auth = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService, mail as unknown as MailService);
  });

  it('hashes a fresh 256-bit random credential for every quick customer without returning it', async () => {
    const hashSpy = jest.spyOn(bcrypt, 'hash');
    try {
      const first = await customers.createQuickCustomer('a', contact);
      const second = await customers.createQuickCustomer('a', contact);
      const credentials = hashSpy.mock.calls.map(([value]) => String(value));
      expect(credentials).toHaveLength(2);
      expect(credentials.every((value) => /^[0-9a-f]{64}$/.test(value))).toBe(true);
      expect(new Set(credentials).size).toBe(2);
      expect(await bcrypt.compare(credentials[0], users[0].passwordHash)).toBe(true);
      expect(await bcrypt.compare(credentials[0], users[1].passwordHash)).toBe(false);
      for (const response of [first, second]) {
        const json = JSON.stringify(response);
        expect(credentials.some((value) => json.includes(value))).toBe(false);
        expect(json.includes('passwordHash')).toBe(false);
        expect(response.user.role).toBe('CUSTOMER');
        expect(response.businessId).toBe('a');
      }
      expect(first.user.email).not.toBe(second.user.email);
      expect(first.user.email).toMatch(/^cliente\.[0-9a-f-]{36}@washsync\.local$/);
      expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    } finally { hashSpy.mockRestore(); }
  });

  it.each([undefined, 'real@example.test'])('does not allow login with a guessed credential (email %s)', async (email) => {
    const result = await customers.createQuickCustomer('a', { ...contact, email });
    await expect(auth.login({ email: result.user.email, password: 'password', businessSlug: 'wash-a' }))
      .rejects.toThrow('Credenciais inválidas');
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('allows a real email owner to reset the password and then log in through existing services', async () => {
    const result = await customers.createQuickCustomer('a', { ...contact, email: ' Real@EXAMPLE.TEST ' });
    expect(result.user.email).toBe('real@example.test');
    const originalHash = users[0].passwordHash;
    const response = await auth.forgotPassword(result.user.email, 'wash-a');
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const [recipient, url] = mail.sendPasswordResetEmail.mock.calls[0];
    expect(recipient).toBe('real@example.test');
    const token = new URL(url).searchParams.get('token')!;
    expect(resets[0].tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(resets[0]).not.toHaveProperty('token');
    expect(JSON.stringify(response).includes(token)).toBe(false);
    const chosenPassword = 'customer-chosen-test-password';
    await auth.resetPassword(token, chosenPassword);
    expect(users[0].passwordHash === originalHash).toBe(false);
    expect(users[0].tokenVersion).toBe(1);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: users[0].id, isRevoked: false }, data: { isRevoked: true },
    });
    expect((await auth.login({ email: result.user.email, password: chosenPassword, businessSlug: 'wash-a' })).tokenType).toBe('Bearer');
    await expect(auth.resetPassword(token, 'another-test-password')).rejects.toThrow('Link de recuperacao invalido ou expirado');
  });

  it('does not issue recovery tokens or mail for synthetic emails, including legacy accounts', async () => {
    await customers.createQuickCustomer('a', contact);
    users.push({ ...users[0], id: 'legacy-user', email: 'cliente.123@washsync.local' });
    const generic = await auth.forgotPassword('missing@example.test', 'wash-a');
    for (const email of [users[0].email, 'cliente.123@washsync.local']) {
      expect(await auth.forgotPassword(email, 'wash-a')).toEqual(generic);
    }
    expect(prisma.passwordResetToken.create.mock.calls.length).toBe(0);
    expect(mail.sendPasswordResetEmail.mock.calls.length).toBe(0);
  });

  it('keeps recovery isolated by business for identical real emails', async () => {
    for (const businessId of ['a', 'b']) await customers.createQuickCustomer(businessId, { ...contact, email: 'same@example.test' });
    await auth.forgotPassword('same@example.test', 'wash-b');
    expect(resets[0].userId).toBe(users[1].id);
    await auth.forgotPassword('same@example.test', 'unknown-wash');
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects expired or invalid recovery links', async () => {
    await customers.createQuickCustomer('a', { ...contact, email: 'real@example.test' });
    await auth.forgotPassword('real@example.test', 'wash-a');
    const token = new URL(mail.sendPasswordResetEmail.mock.calls[0][1]).searchParams.get('token')!;
    resets[0].expiresAt = new Date(0);
    await expect(auth.resetPassword(token, 'chosen-test-password')).rejects.toThrow();
    await expect(auth.resetPassword('invalid-token', 'chosen-test-password')).rejects.toThrow();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('removes the recovery record on mail failure and preserves the generic response', async () => {
    await customers.createQuickCustomer('a', { ...contact, email: 'real@example.test' });
    const generic = await auth.forgotPassword('missing@example.test', 'wash-a');
    mail.sendPasswordResetEmail.mockRejectedValue(new Error('simulated mail failure'));
    expect(await auth.forgotPassword('real@example.test', 'wash-a')).toEqual(generic);
    expect(resets).toHaveLength(0);
  });
});
