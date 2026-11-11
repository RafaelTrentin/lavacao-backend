import { AddressesService } from './modules/addresses/addresses.service';
import { BusinessService } from './modules/business/business.service';
import { ExtraServicesService } from './modules/extra-services/extra-services.service';

describe('Explicit Prisma write projections', () => {
  let db: any;
  const hostile = { id: 'replacement', businessId: 'b', customerId: 'customer-b', deletedAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(), business: { connect: { id: 'b' } },
    customer: { connect: { id: 'customer-b' } }, displayOrder: 999, serviceModeId: 'foreign' };
  beforeEach(() => {
    db = Object.fromEntries(['address', 'business', 'businessBranding', 'businessAddress', 'extraService', 'extraServiceRequest']
      .map((model) => [model, { findUnique: jest.fn(async () => ({ id: 'a', businessId: 'a', customerId: 'customer-a',
        deletedAt: null, isActive: true, businessAddress: {} })), findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => data), update: jest.fn(async ({ data }) => data) }]));
  });
  function noProtectedFields(data: any) {
    for (const key of ['id', 'deletedAt', 'createdAt', 'updatedAt', 'business', 'customer', 'serviceModeId']) {
      expect(data).not.toHaveProperty(key);
    }
  }
  it('projects address creation/update and keeps trusted ownership', async () => {
    const service = new AddressesService(db);
    const input: any = { ...hostile, streetAddress: 'Allowed street', number: '1', neighborhood: 'Center', city: 'City', state: 'SC', zipCode: '00000000' };
    const created = await service.createAddress('a', 'customer-a', input);
    expect(created).toMatchObject({ businessId: 'a', customerId: 'customer-a', streetAddress: 'Allowed street' });
    noProtectedFields(created);
    const updated = await service.updateAddress('a', 'a', 'customer-a', input);
    noProtectedFields(updated);
    expect(updated).not.toHaveProperty('businessId');
    expect(updated).not.toHaveProperty('customerId');
    expect(db.address.update).toHaveBeenCalledWith({ where: { id: 'a', businessId: 'a', customerId: 'customer-a', deletedAt: null }, data: updated });
  });
  it('projects branding and business address updates', async () => {
    const service = new BusinessService(db, {} as any);
    const branding = await service.updateBusinessBranding('a', { ...hostile, primaryColor: '#123456' });
    expect(branding.primaryColor).toBe('#123456');
    noProtectedFields(branding);
    expect(branding).not.toHaveProperty('businessId');
    const address = await service.updateBusinessAddress('a', { ...hostile, city: 'Allowed city', latitude: -27, longitude: -48 });
    noProtectedFields(address);
    expect(address).not.toHaveProperty('businessId');
    expect(address.city).toBe('Allowed city');
    expect(address.latitude.toNumber()).toBe(-27);
  });
  it('projects extra-service writes and keeps display order server-owned', async () => {
    const service = new ExtraServicesService(db);
    const created = await service.createExtraService('a', { ...hostile, name: '  Wash  ', description: 'Allowed' });
    expect(created).toMatchObject({ businessId: 'a', displayOrder: 1, name: 'Wash', description: 'Allowed' });
    noProtectedFields(created);
    const updated = await service.updateExtraService('a', 'a', { ...hostile, name: ' Wash ', isActive: false });
    expect(updated).toMatchObject({ name: 'Wash', isActive: false });
    noProtectedFields(updated);
    expect(updated).not.toHaveProperty('businessId');
    expect(updated).not.toHaveProperty('displayOrder');
  });
  it('keeps request status/customer/tenant under service control', async () => {
    const service = new ExtraServicesService(db);
    const created = await service.createExtraServiceRequest('a', 'customer-a', { ...hostile, extraServiceId: 'a',
      description: 'Allowed', status: 'COMPLETED', quotedPriceInCents: 1 } as any);
    expect(created).toEqual({ businessId: 'a', customerId: 'customer-a', extraServiceId: 'a', description: 'Allowed' });
  });
});
