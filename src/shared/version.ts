import { el } from './utils';

export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD_TIME = __APP_BUILD_TIME__;

export function formatBuildTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function mountVersionBadge(): void {
  if (document.getElementById('app-version-badge')) return;

  const badge = el('div', {
    id: 'app-version-badge',
    className: 'app-version-badge',
    'aria-label': `Version ${APP_VERSION}, published ${formatBuildTime(APP_BUILD_TIME)}`,
  },
    el('span', { className: 'app-version-number' }, `v${APP_VERSION}`),
    el('span', { className: 'app-version-date' }, formatBuildTime(APP_BUILD_TIME))
  );

  document.body.append(badge);
}
