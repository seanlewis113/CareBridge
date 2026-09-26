import { el } from './utils';
import type { RecurringCheckStockLevel } from './types';

export const RECURRING_CHECK_STOCK_OPTIONS: { value: RecurringCheckStockLevel; label: string }[] = [
  { value: 'full', label: 'Full' },
  { value: 'low', label: 'Low' },
  { value: 'out', label: 'Out' },
];

export function stockLevelLabel(level: RecurringCheckStockLevel): string {
  return RECURRING_CHECK_STOCK_OPTIONS.find((o) => o.value === level)?.label ?? level;
}

export function stockLevelBadge(level: RecurringCheckStockLevel): HTMLElement {
  return el('span', { className: `stock-level-badge stock-level-badge--${level}` }, stockLevelLabel(level));
}
