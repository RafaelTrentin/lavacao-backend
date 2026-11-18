import { ValidationPipe } from '@nestjs/common';
import { WalkInDto } from './dto/walk-in.dto';
import { AppointmentsController } from './appointments.controller';
const valid = { customerId: 'customer', serviceModeId: 'mode', vehicleType: 'CAR', requestKey: '11f9aee0-16f0-4d6b-a636-8c8a4e989acc' };
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
describe('Operational input contract', () => {
  it.each([
    { businessId: 'foreign' }, { origin: 'APP' }, { boxId: 'foreign' }, { status: 'COMPLETED' },
    { scheduledStartAt: '2035-01-08T12:00:00Z' }, { startedAt: '2035-01-08T12:00:00Z' },
    { requestKey: 'invalid' }, { vehicleDescription: 'x'.repeat(121) }, { customerId: '' },
  ])('rejects protected or invalid walk-in payload %j', async (extra) => {
    await expect(pipe.transform({ ...valid, ...extra }, { type: 'body', metatype: WalkInDto })).rejects.toMatchObject({ status: 400 });
  });
  it('normalizes vehicle information', async () => {
    expect(await pipe.transform({ ...valid, vehicleDescription: '  Azul  ' }, { type: 'body', metatype: WalkInDto })).toMatchObject({ vehicleDescription: 'Azul' });
  });
  it('derives tenant, actor, time, no pickup and origin from the trusted controller', async () => {
    const service = { createAppointment: jest.fn(async () => ({})) };
    const controller = new AppointmentsController(service as any, {} as any);
    await controller.walkIn({ businessId: 'trusted', userId: 'admin', role: 'ADMIN' } as any, valid);
    expect(service.createAppointment).toHaveBeenCalledWith('trusted', 'customer', 'admin', {
      serviceModeId: 'mode', vehicleType: 'CAR', scheduledStartAt: expect.any(String), willSearchVehicle: false,
    }, { origin: 'WALK_IN', requestKey: valid.requestKey, vehicleDescription: undefined });
  });
});
