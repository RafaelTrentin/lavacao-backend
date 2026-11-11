import { civilDate, dayBounds, localInstants, localParts, uniqueLocalInstant, utcInstant } from './business-time';

describe('Business civil time / UTC', () => {
  it.each(['2027-02-30', '2027-13-01', '2027-01-00', '2027-1-1'])('rejects invalid date %s', (date) => {
    expect(() => civilDate(date)).toThrow();
  });
  it('requires an explicit offset and preserves the represented instant', () => {
    expect(() => utcInstant('2027-01-01T01:00:00')).toThrow();
    expect(utcInstant('2027-01-01T01:00:00-03:00').toISOString()).toBe('2027-01-01T04:00:00.000Z');
  });
  it.each([
    ['America/Sao_Paulo', '2027-01-01T03:00:00.000Z'],
    ['America/Manaus', '2027-01-01T04:00:00.000Z'],
    ['Asia/Kathmandu', '2026-12-31T18:15:00.000Z'],
    ['Pacific/Kiritimati', '2026-12-31T10:00:00.000Z'],
  ])('resolves local midnight in %s independent of process timezone', (zone, expected) => {
    expect(dayBounds('2027-01-01', zone).start.toISOString()).toBe(expected);
  });
  it('does not normalize nonexistent spring-forward times', () => {
    expect(localInstants('2027-03-14', '02:30', 'America/New_York')).toEqual([]);
    expect(() => uniqueLocalInstant('2027-03-14', '02:30', 'America/New_York')).toThrow();
    const { start, end } = dayBounds('2027-03-14', 'America/New_York');
    expect((end.getTime() - start.getTime()) / 3600000).toBe(23);
  });
  it('distinguishes the two fall-back occurrences', () => {
    expect(localInstants('2027-11-07', '01:30', 'America/New_York').map((d) => d.toISOString()))
      .toEqual(['2027-11-07T05:30:00.000Z', '2027-11-07T06:30:00.000Z']);
    expect(() => uniqueLocalInstant('2027-11-07', '01:30', 'America/New_York')).toThrow();
    const { start, end } = dayBounds('2027-11-07', 'America/New_York');
    expect((end.getTime() - start.getTime()) / 3600000).toBe(25);
  });
  it('handles a historic midnight DST gap without changing the date', () => {
    const { start } = dayBounds('2018-11-04', 'America/Sao_Paulo');
    expect(start.toISOString()).toBe('2018-11-04T03:00:00.000Z');
    expect(localParts(start, 'America/Sao_Paulo')).toMatchObject({ date: '2018-11-04', time: '01:00' });
  });
});
