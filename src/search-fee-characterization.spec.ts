import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppointmentsService } from './modules/appointments/appointments.service';
import { CreateAppointmentDto } from './modules/appointments/dto/create-appointment.dto';
import { MapsService } from './modules/maps/maps.service';

// Authorized policy: manual pickup is negotiated outside the app, never charged automatically.
describe('Pickup fee - manual negotiation outside the app', () => {
  let db: any;
  let maps: any;
  let service: AppointmentsService;
  const base = { serviceModeId: 'mode', vehicleType: 'CAR', willSearchVehicle: true,
    scheduledStartAt: '2035-01-08T12:00:00Z' };
  const manual = { ...base, searchType: 'MANUAL_ADDRESS', streetAddress: 'Fixture street', number: '10',
    neighborhood: 'Fixture', city: 'Fixture city', state: 'SC' };
  const create = (dto: any) => service.createAppointment('business-a', 'customer-a', 'user-a', dto);
  const estimate = (dto: any) => service.estimateSearchFee('business-a', 'customer-a', dto);
  beforeEach(() => {
    db = {
      $queryRaw: jest.fn(async () => [{ id: 'business-a' }]),
      serviceMode: { findUnique: jest.fn(async () => ({ id: 'mode', businessId: 'business-a', isActive: true, name: 'Fixture' })) },
      serviceModeRule: { findFirst: jest.fn(async () => ({ id: 'rule', durationMinutes: 40, basePriceInCents: 2000 })) },
      business: { findUnique: jest.fn(async () => ({ id: 'business-a', businessAddress: {
        latitude: new Prisma.Decimal(0), longitude: new Prisma.Decimal(0),
      } })) },
      businessSettings: { findUnique: jest.fn(async () => ({ searchFeeLimitKm: new Prisma.Decimal(5), searchFeeUpTo5km: 500, searchFeeOver5km: 1000 })) },
      user: { findMany: jest.fn(async () => []) },
      address: { findUnique: jest.fn(), update: jest.fn() },
      appointment: { findMany: jest.fn(async () => []), create: jest.fn(async ({ data }) => ({ id: 'fixture', ...data })) },
      appointmentStatusHistory: { create: jest.fn() },
    };
    db.$transaction = jest.fn(async (job) => job(db));
    maps = { geocodeAddress: jest.fn(async () => ({ latitude: 0.01, longitude: 0 })) };
    service = new AppointmentsService(db, { validateSlotAvailability: jest.fn(async () => true) } as any,
      maps, {} as any, {} as any);
  });
  it('GPS creation recalculates price and distance on the server', async () => {
    const dto = { ...base, searchType: 'CURRENT_LOCATION', latitude: 0.01, longitude: 0 };
    const quote = await estimate(dto);
    await create({ ...dto, searchFeeInCents: 1, distanceKm: 0 });
    expect(quote).toMatchObject({ distanceKm: 1.11, searchFeeInCents: 500, totalPriceInCents: 2500 });
    const saved = db.appointment.create.mock.calls[0][0].data;
    expect(saved.snapshotSearchFeeInCents).toBe(500);
    expect(saved.snapshotDistanceKm.toNumber()).toBe(1.11);
    expect(saved.snapshotTotalPriceInCents).toBe(2500);
    expect(maps.geocodeAddress).not.toHaveBeenCalled();
  });
  it('keeps even a geocodable manual address pending externally in quote and creation', async () => {
    expect(await estimate(manual)).toMatchObject({ distanceKm: null, searchFeeInCents: 0, searchFeeStatus: 'TO_CONFIRM_EXTERNALLY', totalPriceInCents: 2000 });
    maps.geocodeAddress.mockClear();
    expect(await create(manual)).toMatchObject({ searchFeeStatus: 'TO_CONFIRM_EXTERNALLY' });
    const saved = db.appointment.create.mock.calls[0][0].data;
    expect(saved.snapshotSearchFeeInCents).toBe(0);
    expect(saved.snapshotDistanceKm).toBeNull();
    expect(saved.snapshotLatitude).toBeNull();
    expect(saved.snapshotTotalPriceInCents).toBe(2000);
    expect(maps.geocodeAddress).not.toHaveBeenCalled();
  });
  it('allows an unlocatable manual address without pretending to know distance or charge', async () => {
    maps.geocodeAddress.mockRejectedValue(new BadRequestException('Address not located'));
    await expect(estimate(manual)).resolves.toMatchObject({ searchFeeStatus: 'TO_CONFIRM_EXTERNALLY', distanceKm: null, searchFeeInCents: 0 });
    await expect(create(manual)).resolves.toMatchObject({ snapshotTotalPriceInCents: 2000, searchFeeStatus: 'TO_CONFIRM_EXTERNALLY' });
    expect(maps.geocodeAddress).not.toHaveBeenCalled();
  });
  it('saved manual address with coordinates is still zero-priced at creation', async () => {
    db.address.findUnique.mockResolvedValue({ id: 'address', businessId: 'business-a', customerId: 'customer-a',
      streetAddress: 'Fixture', latitude: new Prisma.Decimal(0.01), longitude: new Prisma.Decimal(0) });
    expect(await estimate({ ...manual, serviceAddressId: 'address' })).toMatchObject({ searchFeeInCents: 0, searchFeeStatus: 'TO_CONFIRM_EXTERNALLY' });
    await create({ ...manual, serviceAddressId: 'address' });
    expect(db.appointment.create.mock.calls[0][0].data.snapshotSearchFeeInCents).toBe(0);
  });
  it('does not require company geocoding or fee settings for manual pickup', async () => {
    db.business.findUnique.mockRejectedValue(new Error('must not query maps/address'));
    db.businessSettings.findUnique.mockRejectedValue(new Error('must not calculate a fee'));
    await expect(estimate({ ...manual, latitude: 1, longitude: 2 })).resolves.toMatchObject({ searchFeeStatus: 'TO_CONFIRM_EXTERNALLY' });
    await expect(create(manual)).resolves.toMatchObject({ snapshotTotalPriceInCents: 2000 });
  });
  it('still checks ownership of saved manual addresses for quote and creation', async () => {
    db.address.findUnique.mockResolvedValue({ businessId: 'other', customerId: 'other' });
    await expect(estimate({ ...manual, serviceAddressId: 'foreign' })).rejects.toMatchObject({ status: 400 });
    await expect(create({ ...manual, serviceAddressId: 'foreign' })).rejects.toMatchObject({ status: 400 });
    expect(db.appointment.create).not.toHaveBeenCalled();
  });
  it.each([[91, 0], [0, 181], [NaN, 0], [undefined, 0]])('rejects invalid GPS coordinates (%s, %s)', async (latitude, longitude) => {
    const dto = { ...base, searchType: 'CURRENT_LOCATION', latitude, longitude };
    await expect(estimate(dto)).rejects.toMatchObject({ status: 400 });
    await expect(create(dto)).rejects.toMatchObject({ status: 400 });
    expect(db.appointment.create).not.toHaveBeenCalled();
  });
  it('exposes manual pending status on historical list/detail without changing old snapshots', async () => {
    const old = { id: 'historical', businessId: 'business-a', customerId: 'customer-a', willSearchVehicle: true,
      searchType: 'MANUAL_ADDRESS', snapshotSearchFeeInCents: 0, snapshotDistanceKm: new Prisma.Decimal(0), snapshotTotalPriceInCents: 2000 };
    db.appointment.findMany.mockResolvedValue([old]);
    db.appointment.findUnique = jest.fn(async () => old);
    expect((await service.getCustomerAppointments('customer-a', 'business-a'))[0]).toMatchObject({ searchFeeStatus: 'TO_CONFIRM_EXTERNALLY' });
    expect(await service.getAppointmentById('historical', 'business-a')).toMatchObject({ searchFeeStatus: 'TO_CONFIRM_EXTERNALLY' });
    expect(old.snapshotDistanceKm.toNumber()).toBe(0);
    expect(old).not.toHaveProperty('searchFeeStatus');
  });
  it.each([[0, 0], [4.9999, 500], [5, 500], [5.0001, 1000], [100, 1000]])(
    'preserves the current distance band at %s km: %s cents (not a service-radius limit)', async (km, cents) => {
      jest.spyOn(service as any, 'calculateHaversineKm').mockReturnValue(km);
      expect(await estimate({ ...base, searchType: 'CURRENT_LOCATION', latitude: 0.01, longitude: 0 }))
        .toMatchObject({ searchFeeInCents: cents, distanceKm: Number(km.toFixed(2)) });
    });
  it('rejects client-supplied final fee/distance in the global DTO whitelist', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    await expect(pipe.transform({ ...manual, searchFeeInCents: 1, distanceKm: 0 },
      { type: 'body', metatype: CreateAppointmentDto })).rejects.toMatchObject({ status: 400 });
  });
});

describe('Geocoding response characterization without provider access', () => {
  afterEach(() => jest.restoreAllMocks());
  const maps = () => new MapsService({ get: () => 'isolated-fixture-key' } as any);
  const address = { streetAddress: 'Fixture', city: 'Fixture', state: 'SC' };
  it('rejects an address without results', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ features: [] }) } as Response);
    await expect(maps().geocodeAddress(address)).rejects.toMatchObject({ status: 400 });
  });
  it('currently accepts the first result even when it is only a low-confidence city match', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ features: [{
      geometry: { coordinates: [-48, -27] }, properties: { layer: 'locality', confidence: 0.1 },
    }] }) } as Response);
    await expect(maps().geocodeAddress(address)).resolves.toMatchObject({ latitude: -27, longitude: -48 });
  });
});
