import { api } from './api';
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

export function createStockLevelButtons(
  checkId: string,
  profileId: string | undefined,
  refresh: () => void | Promise<void>,
  size: 'sm' | 'md' = 'md'
): HTMLElement {
  const wrap = el('div', { className: `stock-level-buttons stock-level-buttons--${size}` });
  for (const opt of RECURRING_CHECK_STOCK_OPTIONS) {
    const btn = el(
      'button',
      {
        type: 'button',
        className: `btn stock-level-btn stock-level-btn--${opt.value}${size === 'sm' ? ' btn-sm' : ''}`,
      },
      opt.label
    );
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!profileId) return;
      wrap.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = true; });
      try {
        await api.completeRecurringCheck(checkId, profileId, opt.value);
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not record check');
        wrap.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = false; });
      }
    });
    wrap.append(btn);
  }
  return wrap;
}
