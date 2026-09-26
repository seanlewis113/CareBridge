import { el } from './utils';
import { daysUntil, formatDate } from './utils';

export type PrescriptionRefillUrgency = 'unset' | 'ok' | 'soon' | 'overdue';

const SOON_DAYS = 7;

export function prescriptionRefillUrgency(nextRefillDate: string | null): PrescriptionRefillUrgency {
  if (!nextRefillDate) return 'unset';
  const days = daysUntil(nextRefillDate);
  if (days < 0) return 'overdue';
  if (days <= SOON_DAYS) return 'soon';
  return 'ok';
}

export function prescriptionRefillLabel(nextRefillDate: string | null): string {
  if (!nextRefillDate) return 'Refill date not set';
  const days = daysUntil(nextRefillDate);
  if (days < 0) {
    const overdue = Math.abs(days);
    if (overdue === 1) return 'Overdue by 1 day';
    return `Overdue by ${overdue} days`;
  }
  if (days === 0) return 'Refill due today';
  if (days === 1) return 'Refill due tomorrow';
  if (days <= SOON_DAYS) return `Refill in ${days} days`;
  return `Next refill ${formatDate(nextRefillDate)}`;
}

export function prescriptionRefillBadge(nextRefillDate: string | null): HTMLElement {
  const urgency = prescriptionRefillUrgency(nextRefillDate);
  const label =
    urgency === 'unset'
      ? 'No date'
      : urgency === 'overdue'
        ? 'Overdue'
        : urgency === 'soon'
          ? 'Due soon'
          : 'On track';
  return el('span', { className: `refill-badge refill-badge--${urgency}` }, label);
}

export function prescriptionsNeedingAttention(
  prescriptions: { active: boolean; next_refill_date: string | null }[]
): number {
  return prescriptions.filter(
    (rx) => rx.active && prescriptionRefillUrgency(rx.next_refill_date) !== 'ok'
  ).length;
}
