import { BadRequestException } from '@nestjs/common';

const formatters = new Map<string, Intl.DateTimeFormat>();
export function businessTimezone(value?: string | null): string {
  const zone = value || 'America/Sao_Paulo';
  if (/^[+-]/.test(zone)) throw new BadRequestException('Informe um timezone IANA, não um offset fixo');
  if (!formatters.has(zone)) {
    try {
      formatters.set(zone, new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }));
    } catch { throw new BadRequestException('Timezone da empresa inválido'); }
  }
  return zone;
}
export function localParts(instant: Date, zone: string) {
  const parts = Object.fromEntries(formatters.get(businessTimezone(zone))!.formatToParts(instant)
    .map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`,
    second: parts.second };
}
export function civilDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Data inválida. Use YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Data inválida');
  }
  return value;
}
export function addCivilDays(value: string, days: number): string {
  return new Date(new Date(`${civilDate(value)}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}
export function weekday(value: string): string {
  return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
    [new Date(`${civilDate(value)}T00:00:00Z`).getUTCDay()];
}

/** Enumerate UTC candidates, then round-trip. Never normalize DST gaps silently.
 * A repeated local minute has two candidates; callers must preserve its instant.
 */
export function localInstants(date: string, time: string, zone: string): Date[] {
  civilDate(date); businessTimezone(zone);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new BadRequestException('Horário inválido');
  const nominal = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = new Date(nominal + hours * 3600000);
    const local = localParts(sample, zone);
    offsets.add(Date.parse(`${local.date}T${local.time}:${local.second}Z`) - sample.getTime());
  }
  return [...offsets].map((offset) => new Date(nominal - offset)).filter((instant) => {
    const local = localParts(instant, zone);
    return local.date === date && local.time === time;
  }).sort((a, b) => a.getTime() - b.getTime());
}
export function uniqueLocalInstant(date: string, time: string, zone: string): Date {
  const candidates = localInstants(date, time, zone);
  if (candidates.length !== 1) throw new BadRequestException('Horário local inexistente ou ambíguo nesse timezone');
  return candidates[0];
}
export function dayStart(date: string, zone: string): Date {
  // Some IANA regions advance their clocks at midnight. The local day then
  // starts at its first existing minute, not at a shifted date on the server.
  for (let minute = 0; minute < 1440; minute++) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const candidates = localInstants(date, time, zone);
    if (candidates.length) return candidates[0];
  }
  throw new BadRequestException('Data inexistente no timezone da empresa');
}
export function dayBounds(date: string, zone: string) {
  return { start: dayStart(date, zone), end: dayStart(addCivilDays(date, 1), zone) };
}
export function utcInstant(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new BadRequestException('Informe data/hora com Z ou offset explícito');
  }
  civilDate(value.slice(0, 10));
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new BadRequestException('Data/hora inválida');
  return instant;
}
export function notificationDate(instant: Date, zone: string): string {
  const local = localParts(instant, zone);
  return `${local.date.split('-').reverse().join('/')} às ${local.time}`;
}
