export function formatAppError(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(dateStr: string): string {
  return `${formatDate(dateStr)} at ${formatTime(dateStr)}`;
}

export function daysSince(dateStr: string): number {
  const then = new Date(dateStr);
  const now = new Date();
  const thenDay = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((nowDay.getTime() - thenDay.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysSinceLabel(dateStr: string): string {
  const days = daysSince(dateStr);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function formatRelativeTime(dateStr: string): string {
  const days = daysSince(dateStr);
  if (days === 0) return formatTime(dateStr);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'className') {
      element.className = String(value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) {
      element.setAttribute(key, '');
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function clearElement(element: HTMLElement): void {
  element.replaceChildren();
}

export interface ShowModalOptions {
  headerMeta?: HTMLElement;
}

export function showModal(
  title: string,
  content: HTMLElement,
  onClose?: () => void,
  options?: ShowModalOptions
): () => void {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true' });
  const titleGroup = el('div', { className: 'modal-header-title' }, el('h2', {}, title));
  if (options?.headerMeta) titleGroup.append(options.headerMeta);
  const header = el('div', { className: 'modal-header' }, titleGroup);
  const closeBtn = el('button', { className: 'modal-close', type: 'button', 'aria-label': 'Close' }, '×');
  header.append(closeBtn);
  modal.append(header, content);
  overlay.append(modal);
  document.body.append(overlay);
  document.body.classList.add('modal-open');

  const close = () => {
    overlay.remove();
    document.body.classList.remove('modal-open');
    onClose?.();
  };

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return close;
}

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  let container = document.querySelector('.toast-container') as HTMLElement | null;
  if (!container) {
    container = el('div', { className: 'toast-container' });
    document.body.append(container);
  }
  const toast = el('div', { className: `toast toast-${type}` }, message);
  container.append(toast);
  setTimeout(() => toast.remove(), 3000);
}

export function emptyState(
  iconEl: SVGSVGElement,
  title: string,
  description: string,
  action?: HTMLElement
): HTMLElement {
  const wrap = el('div', { className: 'empty-state' },
    el('div', { className: 'empty-state-icon' }, iconEl),
    el('h3', {}, title),
    el('p', {}, description)
  );
  if (action) wrap.append(action);
  return wrap;
}

export function timeOfDayClass(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'time-morning';
  if (hour < 17) return 'time-afternoon';
  return 'time-evening';
}

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const content = el('div', { className: 'modal-body' }, el('p', {}, message));
    const actions = el('div', { className: 'modal-actions' });
    const cancelBtn = el('button', { className: 'btn btn-secondary', type: 'button' }, 'Cancel');
    const okBtn = el('button', { className: 'btn btn-primary', type: 'button' }, 'Confirm');
    actions.append(cancelBtn, okBtn);
    content.append(actions);

    const close = showModal('Please confirm', content);
    cancelBtn.addEventListener('click', () => {
      close();
      resolve(false);
    });
    okBtn.addEventListener('click', () => {
      close();
      resolve(true);
    });
  });
}
