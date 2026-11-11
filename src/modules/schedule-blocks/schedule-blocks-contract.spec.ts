import { ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateScheduleBlockDto } from './dto/create-schedule-block.dto';
import { UpdateScheduleBlockDto } from './dto/update-schedule-block.dto';
import { ScheduleBlocksService } from './schedule-blocks.service';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const parse = <T>(metatype: new () => T, value: unknown): Promise<T> => pipe.transform(value, { type: 'body', metatype });

describe('Schedule block write contract', () => {
  let service: ScheduleBlocksService;
  let row: any;
  let db: any;
  beforeEach(() => {
    row = { id: 'block-a', businessId: 'a', deletedAt: null, type: 'TIME_RANGE', isActive: true,
      startAt: new Date('2035-01-08T13:00:00Z'), endAt: new Date('2035-01-08T14:00:00Z'),
      isRecurring: false, recurringDays: null, recurringEndDate: null, createdAt: new Date('2030-01-01T00:00:00Z') };
    db = { $queryRaw: jest.fn(async () => [{ id: 'a' }]),
      appointment: { findMany: jest.fn(async () => []) },
      business: { findUnique: jest.fn(async () => ({ timezone: 'America/Sao_Paulo' })) },
      scheduleBlock: {
        findUnique: jest.fn(async () => row),
        create: jest.fn(async ({ data }) => data),
        update: jest.fn(async ({ data }) => data),
      } };
    db.$transaction = jest.fn(async (work) => work(db));
    service = new ScheduleBlocksService(db);
  });
  const create = async (payload: unknown) => service.createScheduleBlock('a', await parse(CreateScheduleBlockDto, payload));
  const update = async (payload: unknown) => service.updateScheduleBlock('block-a', 'a', await parse(UpdateScheduleBlockDto, payload));
  const valid = { type: 'TIME_RANGE', blockDate: '2035-01-08', blockStartTime: '10:00', blockEndTime: '11:00' };

  it.each(['id', 'businessId', 'business', 'deletedAt', 'createdAt', 'updatedAt', 'unknown'])('rejects protected/unknown %s on both writes', async (field) => {
    await expect(create({ ...valid, [field]: 'malicious' })).rejects.toMatchObject({ status: 400 });
    await expect(update({ reason: 'allowed', [field]: 'malicious' })).rejects.toMatchObject({ status: 400 });
    expect(db.scheduleBlock.create).not.toHaveBeenCalled();
    expect(db.scheduleBlock.update).not.toHaveBeenCalled();
  });
  it('normalizes reason, clocks and recurrence days without coercing boolean strings', async () => {
    const result = await create({ ...valid, blockStartTime: ' 10:00 ', reason: '  Maintenance  ',
      isRecurring: true, recurringDays: [' monday ', 'TUESDAY'], recurringEndDate: '2035-02-01' });
    expect(result).toMatchObject({ businessId: 'a', reason: 'Maintenance', recurringDays: ['MONDAY', 'TUESDAY'],
      startAt: new Date('2035-01-08T13:00:00Z'), endAt: new Date('2035-01-08T14:00:00Z') });
    await expect(update({ isActive: 'false' })).rejects.toMatchObject({ status: 400 });
  });
  it.each(['type', 'startAt', 'endAt', 'isActive', 'isRecurring'])('rejects null for non-nullable %s', async (field) => {
    await expect(update({ [field]: null })).rejects.toMatchObject({ status: 400 });
    expect(db.scheduleBlock.update).not.toHaveBeenCalled();
  });
  it.each([
    { blockStartTime: '25:00' }, { blockEndTime: '10:00' }, { blockEndTime: '09:00' },
    { blockDate: '2035-02-30' }, { blockStartTime: null }, { isRecurring: null },
    { isRecurring: true }, { isRecurring: true, recurringDays: [] },
    { isRecurring: true, recurringDays: ['MONDAY', ' monday '] },
    { isRecurring: true, recurringDays: ['NOT_A_DAY'] },
    { isRecurring: true, recurringDays: ['MONDAY'], recurringEndDate: '2035-01-07' },
    { isRecurring: false, recurringDays: ['MONDAY'] },
    { type: 'FULL_DAY', blockEndDate: '2035-01-07' },
    { type: 'FULL_DAY', blockEndDate: '2035-02-30' },
    { blockEndDate: '2035-01-10' },
    { type: 'FULL_DAY', blockEndDate: '2035-01-10', isRecurring: true, recurringDays: ['MONDAY'] },
  ])('rejects invalid creation %j', async (patch) => {
    await expect(create({ ...valid, ...patch })).rejects.toMatchObject({ status: 400 });
    expect(db.scheduleBlock.create).not.toHaveBeenCalled();
  });
  it.each([
    { startAt: '2035-01-08T13:00:00' }, { endAt: '2035-01-08T12:00:00Z' },
    { startAt: '2035-02-30T13:00:00Z' }, { isRecurring: true },
    { recurringDays: ['MONDAY'] }, { type: 'FULL_DAY' },
    { startAt: { set: '2035-01-08T13:00:00Z' } },
  ])('rejects invalid merged update %j', async (patch) => {
    await expect(update(patch)).rejects.toMatchObject({ status: 400 });
    expect(db.scheduleBlock.update).not.toHaveBeenCalled();
  });
  it('validates end of recurrence against a start changed by the same patch', async () => {
    Object.assign(row, { isRecurring: true, recurringDays: ['MONDAY'], recurringEndDate: new Date('2035-02-01T00:00:00Z') });
    await expect(update({ startAt: '2035-02-02T13:00:00Z', endAt: '2035-02-02T14:00:00Z' })).rejects.toMatchObject({ status: 400 });
  });
  it('supports enabling, editing and disabling recurrence, including an open end', async () => {
    const enabled = await update({ isRecurring: true, recurringDays: ['monday'], recurringEndDate: '2035-02-01' });
    expect(enabled).toMatchObject({ isRecurring: true, recurringDays: ['MONDAY'] });
    Object.assign(row, enabled);
    expect(await update({ recurringEndDate: null, reason: null })).toMatchObject({ isRecurring: true, recurringEndDate: null, reason: null });
    expect(await update({ isRecurring: false })).toMatchObject({ isRecurring: false, recurringDays: Prisma.DbNull, recurringEndDate: null });
    await expect(update({ recurringDays: null })).rejects.toMatchObject({ status: 400 });
  });
  it('keeps tenant/metadata out of Prisma even for an unvalidated internal object', async () => {
    const result = await service.updateScheduleBlock('block-a', 'a', { reason: 'safe', businessId: 'b',
      id: 'replacement', createdAt: new Date(), deletedAt: new Date(), business: { connect: { id: 'b' } } } as any);
    expect(Object.keys(result).sort()).toEqual(['type','startAt','endAt','reason','isRecurring','recurringDays','recurringEndDate','isActive'].sort());
    expect(db.scheduleBlock.update).toHaveBeenLastCalledWith({ where: { id: 'block-a', businessId: 'a', deletedAt: null }, data: result });
  });
  it.each(['foreign', 'deleted'])('does not update a %s block', async (state) => {
    if (state === 'foreign') row.businessId = 'b'; else row.deletedAt = new Date();
    await expect(update({ reason: 'safe' })).rejects.toMatchObject({ status: 404 });
    expect(db.scheduleBlock.update).not.toHaveBeenCalled();
  });
  it('accepts the legacy inclusive full-day boundary without rewriting it', async () => {
    Object.assign(row, { type: 'FULL_DAY', startAt: new Date('2035-01-08T03:00:00Z'), endAt: new Date('2035-01-09T02:59:59.999Z') });
    expect(await update({ type: 'FULL_DAY', reason: 'valid' })).toMatchObject({ startAt: row.startAt, endAt: row.endAt });
  });
});
