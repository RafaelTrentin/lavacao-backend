import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WashBoxesController } from './wash-boxes.controller';
import { WashBoxesService } from './wash-boxes.service';
import { CreateWashBoxDto, UpdateWashBoxDto } from './wash-box.dto';
import { JwtGuard } from '../../common/guards/jwt.guard';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const validate = (value: unknown, metatype = CreateWashBoxDto) => pipe.transform(value, { type: 'body', metatype });
describe('Wash box HTTP contract', () => {
  it('normalizes names and accepts partial activation updates', async () => {
    expect(await validate({ name: '  Box 1  ', serviceModeIds: ['mode'] })).toMatchObject({ name: 'Box 1' });
    expect(await validate({ isActive: false }, UpdateWashBoxDto)).toMatchObject({ isActive: false });
  });
  it.each([
    { name: '' }, { name: '   ' }, { name: null }, { name: 'x', isActive: null },
    { name: 'x', serviceModeIds: null }, { name: 'x', serviceModeIds: ['m', 'm'] },
    { name: 'x', serviceModeIds: [1] }, { name: 'x', serviceModeIds: [''] },
    { name: 'x', businessId: 'foreign' }, { name: 'x', isLegacyDefault: true },
    { name: 'x', id: 'injected' }, { name: 'x', deletedAt: null }, { name: 'x', createdAt: '2030-01-01' },
  ])('rejects malformed or protected payload %j', async (payload) => {
    await expect(validate(payload)).rejects.toMatchObject({ status: 400 });
    await expect(validate(payload, UpdateWashBoxDto)).rejects.toMatchObject({ status: 400 });
  });

  let app: any, base: string;
  const service = { list: jest.fn(async () => []), create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [WashBoxesController], providers: [{ provide: WashBoxesService, useValue: service }] })
      .overrideGuard(JwtGuard).useValue({ canActivate: (context: any) => {
        const req = context.switchToHttp().getRequest();
        if (!req.headers['x-test-role']) return false;
        req.user = { userId: 'fixture', businessId: 'trusted-tenant', role: req.headers['x-test-role'] }; return true;
      } }).compile();
    app = module.createNestApplication(); app.useGlobalPipes(pipe); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => jest.clearAllMocks());
  it('rejects customers and unauthenticated callers', async () => {
    for (const role of ['', 'CUSTOMER']) {
      const response = await fetch(base + '/admin/wash-boxes', { headers: role ? { 'x-test-role': role } : {} });
      expect(response.status).toBe(403);
    }
    expect(service.list).not.toHaveBeenCalled();
  });
  it('derives tenant exclusively from the authenticated context', async () => {
    const response = await fetch(base + '/admin/wash-boxes/box-id', { method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'ADMIN' }, body: JSON.stringify({ name: ' New ' }) });
    expect(response.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith('trusted-tenant', 'box-id', expect.objectContaining({ name: 'New' }));
    const bad = await fetch(base + '/admin/wash-boxes', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'ADMIN' }, body: JSON.stringify({ name: 'New', businessId: 'foreign' }) });
    expect(bad.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });
});
