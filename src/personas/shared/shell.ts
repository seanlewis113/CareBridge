import { signOut } from '../../shared/auth';
import { navigate, link } from '../../shared/router';
import { el } from '../../shared/utils';
import { icon, type IconName } from '../../shared/icons';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

function isActive(activePath: string, itemPath: string): boolean {
  if (itemPath === '/admin' || itemPath === '/caregiver') {
    return activePath === itemPath;
  }
  return activePath === itemPath || activePath.startsWith(itemPath + '/');
}

function renderSidebar(
  brandTitle: string,
  navItems: NavItem[],
  activePath: string
): HTMLElement {
  const sidebar = el('aside', { className: 'app-sidebar' });

  const brand = el('div', { className: 'app-sidebar-brand' },
    el('div', { className: 'app-sidebar-brand-icon' }, icon('heart')),
    el('h1', {}, brandTitle)
  );

  const nav = el('nav', { className: 'app-sidebar-nav', 'aria-label': 'Main navigation' });
  for (const item of navItems) {
    const a = link(item.path, '');
    a.append(icon(item.icon), document.createTextNode(item.label));
    if (isActive(activePath, item.path)) a.classList.add('active');
    nav.append(a);
  }

  const switchBtn = el('button', { className: 'btn btn-ghost', type: 'button' },
    icon('log-out'),
    'Switch Persona'
  );
  switchBtn.addEventListener('click', () => { signOut(); navigate('/'); });

  const footer = el('div', { className: 'app-sidebar-footer' }, switchBtn);

  sidebar.append(brand, nav, footer);
  return sidebar;
}

function renderMobileHeader(title: string): HTMLElement {
  const switchBtn = el('button', { className: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Switch persona' },
    icon('log-out')
  );
  switchBtn.addEventListener('click', () => { signOut(); navigate('/'); });

  return el('header', { className: 'app-header' },
    el('h1', {},
      el('span', { className: 'app-header-logo' }, icon('heart')),
      title
    ),
    el('div', { className: 'app-header-actions' }, switchBtn)
  );
}

function renderBottomNav(
  primaryItems: NavItem[],
  moreItems: NavItem[],
  activePath: string
): HTMLElement {
  const nav = el('nav', { className: 'app-bottom-nav', 'aria-label': 'Mobile navigation' });

  for (const item of primaryItems) {
    const a = link(item.path, '');
    a.append(icon(item.icon), el('span', {}, item.label));
    if (isActive(activePath, item.path)) a.classList.add('active');
    nav.append(a);
  }

  const moreActive = moreItems.some((item) => isActive(activePath, item.path));
  const moreBtn = el('button', {
    type: 'button',
    className: moreActive ? 'active' : '',
    'aria-label': 'More options',
  },
    icon('more-horizontal'),
    el('span', {}, 'More')
  );

  moreBtn.addEventListener('click', () => {
    const overlay = el('div', { className: 'more-menu-overlay' });
    const sheet = el('div', { className: 'more-menu-sheet' },
      el('h3', {}, 'More')
    );
    const grid = el('div', { className: 'more-menu-grid' });

    for (const item of moreItems) {
      const a = link(item.path, '');
      a.className = 'more-menu-item';
      if (isActive(activePath, item.path)) a.style.background = 'var(--color-primary-light)';
      a.append(icon(item.icon), el('span', {}, item.label));
      a.addEventListener('click', () => { overlay.remove(); sheet.remove(); });
      grid.append(a);
    }

    sheet.append(grid);
    document.body.append(overlay, sheet);

    const close = () => { overlay.remove(); sheet.remove(); };
    overlay.addEventListener('click', close);
  });

  nav.append(moreBtn);
  return nav;
}

export function renderAdminShell(content: HTMLElement, activePath: string): void {
  const app = document.getElementById('app')!;
  app.className = 'admin-app';

  const allItems: NavItem[] = [
    { path: '/admin', label: 'Dashboard', icon: 'layout' },
    { path: '/admin/tasks', label: 'Tasks', icon: 'clipboard-list' },
    { path: '/admin/calendar', label: 'Calendar', icon: 'calendar' },
    { path: '/admin/reminders', label: 'Reminders', icon: 'bell' },
    { path: '/admin/visits', label: 'Visit Notes', icon: 'file-text' },
    { path: '/admin/documents', label: 'Documents', icon: 'folder' },
    { path: '/admin/finance', label: 'Financials', icon: 'dollar-sign' },
    { path: '/admin/settings', label: 'Settings', icon: 'settings' },
  ];

  const primaryItems = allItems.slice(0, 4);
  const moreItems = allItems.slice(4);

  const layout = el('div', { className: 'admin-layout page-enter' });
  const sidebar = renderSidebar("Mom's Care", allItems, activePath);
  const body = el('div', { className: 'app-shell-body' });

  body.append(
    renderMobileHeader('Admin'),
    el('main', { className: 'app-content' }, content),
    renderBottomNav(primaryItems, moreItems, activePath)
  );

  layout.append(sidebar, body);
  app.replaceChildren(layout);
}

export function renderCaregiverShell(content: HTMLElement, activePath: string): void {
  const app = document.getElementById('app')!;
  app.className = 'caregiver-app';

  const allItems: NavItem[] = [
    { path: '/caregiver', label: 'Today', icon: 'sun' },
    { path: '/caregiver/calendar', label: 'Calendar', icon: 'calendar' },
    { path: '/caregiver/tasks', label: 'My Tasks', icon: 'clipboard-list' },
    { path: '/caregiver/visit', label: 'Log Visit', icon: 'pen-line' },
    { path: '/caregiver/notes', label: 'Visit History', icon: 'file-text' },
    { path: '/caregiver/documents', label: 'Documents', icon: 'folder' },
  ];

  const primaryItems = allItems.slice(0, 4);
  const moreItems = allItems.slice(4);

  const layout = el('div', { className: 'caregiver-layout page-enter' });
  const sidebar = renderSidebar("Mom's Care", allItems, activePath);
  const body = el('div', { className: 'app-shell-body' });

  body.append(
    renderMobileHeader("Mom's Care"),
    el('main', { className: 'app-content' }, content),
    renderBottomNav(primaryItems, moreItems, activePath)
  );

  layout.append(sidebar, body);
  app.replaceChildren(layout);
}
