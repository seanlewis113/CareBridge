import type { Persona } from './types';

type RouteHandler = () => void | Promise<void>;

const routes = new Map<string, RouteHandler>();
let currentRoute = '';
let appRoot: HTMLElement | null = null;
let onNavigate: ((path: string) => void) | null = null;

export function initRouter(root: HTMLElement, navigateCallback?: (path: string) => void): void {
  appRoot = root;
  onNavigate = navigateCallback ?? null;
  window.addEventListener('popstate', () => navigate(getPathFromHash()));
  navigate(getPathFromHash());
}

export function registerRoute(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

function getPathFromHash(): string {
  const hash = window.location.hash.slice(1);
  return hash || '/';
}

function updateBodyAppClass(path: string): void {
  document.body.classList.remove('admin-app', 'caregiver-app', 'mother-app');
  if (path.startsWith('/admin')) document.body.classList.add('admin-app');
  else if (path.startsWith('/caregiver')) document.body.classList.add('caregiver-app');
  else if (path.startsWith('/mother')) document.body.classList.add('mother-app');
}

export async function navigate(path: string): Promise<void> {
  if (!appRoot) return;
  currentRoute = path;
  window.location.hash = path;
  onNavigate?.(path);
  updateBodyAppClass(path);

  let handler = routes.get(path);
  if (!handler && path.startsWith('/admin')) handler = routes.get('/admin/*');
  if (!handler && path.startsWith('/caregiver')) handler = routes.get('/caregiver/*');
  if (!handler && path.startsWith('/mother')) handler = routes.get('/mother/*');

  if (!handler) {
    handler = routes.get('/');
  }

  if (handler) {
    appRoot.replaceChildren();
    await handler();
  }
}

export function getCurrentRoute(): string {
  return currentRoute;
}

export const MODULE_SELECT_PATH = '/select';

export function personaHome(persona: Persona): string {
  switch (persona) {
    case 'mother':
      return '/mother';
    case 'admin':
      return '/admin';
    case 'family_caregiver':
    case 'hired_caregiver':
      return '/caregiver';
    default:
      return '/';
  }
}

export function link(path: string, label: string, className = 'nav-link'): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = `#${path}`;
  a.className = className;
  a.textContent = label;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(path);
  });
  return a;
}
