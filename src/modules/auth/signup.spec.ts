import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UserRole } from 'src/common/enums';

// Only this controller and service are loaded. No AppModule, .env, database
// connection, mail provider or external API is used by this suite.
describe('Public authentication (HTTP, isolated persistence)', () => {
  let app: INestApplication;
  let service: AuthService;
  let baseUrl: string;
  let passwordHash: string;
  let createdUser: Record<string, any> | null;
  const password = 'isolated-test-password';
  const business = { id: 'business-test', slug: 'test-wash', isActive: true, deletedAt: null };
  const signup = {
    name: 'Test Customer', phone: '00000000000', email: 'customer@example.test',
    password, role: 'CUSTOMER', businessSlug: business.slug,
  };
  const existingUsers = [UserRole.CUSTOMER, UserRole.ADMIN].map((role) => ({
    id: `existing-${role}`, email: `${role.toLowerCase()}@example.test`,
    role, businessId: business.id, isActive: true, tokenVersion: 0,
  }));
  const prisma = {
    business: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    refreshToken: { updateMany: jest.fn(), create: jest.fn() },
  };
  const jwt = { sign: jest.fn() };

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 4);
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: MailService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
      exceptionFactory: (errors) => new BadRequestException(errors),
    }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    createdUser = null;
    prisma.business.findFirst.mockImplementation(async ({ where }) =>
      where.slug === business.slug && where.isActive === true && where.deletedAt === null
        ? business : null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => {
      createdUser = { id: 'created-customer', tokenVersion: 0, ...data };
      return createdUser;
    });
    prisma.user.findUnique.mockImplementation(async () => createdUser);
    jwt.sign.mockReturnValue('isolated-token-placeholder');
  });

  afterAll(async () => { await app?.close(); });

  async function post(path: string, body: unknown) {
    const response = await fetch(`${baseUrl}/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it.each(['ADMIN', 'admin', 'SUPERADMIN', null, undefined])(
    'rejects public role %s without writes or tokens', async (role) => {
      const response = await post('signup', { ...signup, role });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('CUSTOMER');
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(jwt.sign).not.toHaveBeenCalled();
    },
  );

  it('also rejects ADMIN when the service is called without the validation pipe', async () => {
    await expect(service.signup({ ...signup, role: UserRole.ADMIN } as unknown as SignupDto))
      .rejects.toThrow('O cadastro público permite somente CUSTOMER');
    expect(prisma.business.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('accepts the current client payload and creates only a customer in the selected business', async () => {
    const valid = await post('signup', {
      ...signup, email: 'New.Customer@EXAMPLE.TEST', businessSlug: ' TEST-WASH ',
    });
    expect(valid.status).toBe(201);
    expect(valid.body).toEqual({
      accessToken: expect.any(String), refreshToken: expect.any(String),
      expiresIn: 86400, tokenType: 'Bearer',
    });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: 'new.customer@example.test', role: UserRole.CUSTOMER, businessId: business.id,
      customerProfile: { create: { name: signup.name, phone: signup.phone, businessId: business.id } },
    });
    expect(data).not.toHaveProperty('adminProfile');
    expect(await bcrypt.compare(password, data.passwordHash)).toBe(true);
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({
      role: UserRole.CUSTOMER, businessId: business.id,
    }), expect.any(Object));
  });

  it.each([undefined, null, '', '   ', 'unknown-business'])('rejects invalid slug %s', async (businessSlug) => {
    const response = await post('signup', { ...signup, businessSlug });
    expect(response.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it.each([
    { ...business, isActive: false },
    { ...business, deletedAt: new Date() },
  ])('rejects unavailable business %#', async (unavailable) => {
    prisma.business.findFirst.mockImplementation(async ({ where }) =>
      unavailable.isActive === where.isActive && unavailable.deletedAt === where.deletedAt
        ? unavailable : null);
    expect((await post('signup', signup)).status).toBe(400);
    expect(prisma.business.findFirst).toHaveBeenCalledWith({
      where: { slug: business.slug, isActive: true, deletedAt: null },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('preserves duplicate-account rejection within the selected business', async () => {
    prisma.user.findFirst.mockResolvedValue(existingUsers[0]);
    expect((await post('signup', signup)).status).toBe(400);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: signup.email, businessId: business.id },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each(existingUsers)('preserves existing $role login with business context', async (user) => {
    prisma.user.findFirst.mockResolvedValue({ ...user, passwordHash });
    prisma.user.findUnique.mockResolvedValue(user);
    const response = await post('login', { email: user.email, password, businessSlug: business.slug });
    expect(response.status).toBe(201);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: user.email, businessId: business.id, isActive: true, deletedAt: null },
    });
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({
      sub: user.id, role: user.role, businessId: business.id,
    }), expect.any(Object));
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('preserves existing administrator login without slug', async () => {
    const user = existingUsers[1];
    prisma.user.findMany.mockResolvedValue([{ ...user, passwordHash }]);
    prisma.user.findUnique.mockResolvedValue(user);
    expect((await post('login', { email: user.email, password })).status).toBe(201);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        email: user.email, role: UserRole.ADMIN, isActive: true, deletedAt: null,
        business: { isActive: true, deletedAt: null },
      },
      take: 2,
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('still rejects invalid login credentials', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...existingUsers[0], passwordHash });
    expect((await post('login', {
      email: signup.email, password: 'incorrect-test-password', businessSlug: business.slug,
    })).status).toBe(401);
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
