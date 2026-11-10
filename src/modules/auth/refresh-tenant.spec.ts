import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

describe('Refresh tenant and availability checks (isolated persistence)', () => {
  let auth: AuthService;
  let user: any;
  let payload: any;
  let hash: string;
  const token = 'isolated-refresh-token';
  const prisma = {
    user: { findUnique: jest.fn() },
    refreshToken: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  };
  const jwt = { verify: jest.fn(), sign: jest.fn() };
  beforeAll(async () => { hash = await bcrypt.hash(token, 4); });
  beforeEach(() => {
    jest.resetAllMocks();
    user = { id: 'user-a', businessId: 'a', tokenVersion: 0, isActive: true, deletedAt: null, business: { isActive: true, deletedAt: null } };
    payload = { sub: user.id, businessId: 'a', tokenVersion: 0 };
    prisma.user.findUnique.mockImplementation(async () => user);
    prisma.refreshToken.findMany.mockResolvedValue([{ id: 'stored-a', token: hash }]);
    jwt.verify.mockImplementation(() => payload);
    jwt.sign.mockReturnValue('isolated-new-token');
    auth = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService, {} as MailService);
  });
  it.each(['inactive-user', 'deleted-user', 'inactive-business', 'deleted-business', 'missing-user', 'wrong-tenant', 'old-version', 'invalid-version', 'missing-sub'])('rejects %s before writes or issuing JWTs', async (state) => {
    if (state === 'inactive-user') user.isActive = false;
    if (state === 'deleted-user') user.deletedAt = new Date();
    if (state === 'inactive-business') user.business.isActive = false;
    if (state === 'deleted-business') user.business.deletedAt = new Date();
    if (state === 'missing-user') user = null;
    if (state === 'wrong-tenant') payload.businessId = 'b';
    if (state === 'old-version') user.tokenVersion = 1;
    if (state === 'invalid-version') payload.tokenVersion = '0';
    if (state === 'missing-sub') delete payload.sub;
    await expect(auth.refreshAccessToken(token)).rejects.toThrow('Refresh token inválido');
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it.each([0, undefined])('preserves valid refresh, including legacy version %s', async (version) => {
    payload.tokenVersion = version;
    expect((await auth.refreshAccessToken(token)).tokenType).toBe('Bearer');
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'user-a', businessId: 'a', tokenVersion: 0 }), expect.any(Object));
  });
  it('still rejects another token hash or a revoked/missing stored token', async () => {
    prisma.refreshToken.findMany.mockResolvedValue([]);
    await expect(auth.refreshAccessToken(token)).rejects.toThrow('Refresh token inválido');
    prisma.refreshToken.findMany.mockResolvedValue([{ id: 'stored-b', token: await bcrypt.hash('different-token', 4) }]);
    await expect(auth.refreshAccessToken(token)).rejects.toThrow('Refresh token inválido');
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
