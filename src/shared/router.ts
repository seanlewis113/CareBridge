import type { Persona } from './types';
import { clearActivePersona } from './auth';

type RouteHandler = () => void | Promise<void>;

const routes = new Map<string, RouteHandler>();
let currentRoute = '';
let appRoot: HTMLElement | null = null;
let onNavigate: ((path: string) => void) | null = null;
let navigationToken = 0;

export function initRouter(root: HTMLElement, navigateCallback?: (path: string) => void): void {
  appRoot = root;
  onNavigate = navigateCallback ?? null;
  window.addEventListener('popstate', () => {
    const path = getPathFromHash();
    if (path === currentRoute) return;
    void navigate(path);
  });
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

function renderRouteError(path: string, err: unknown): void {
  if (!appRoot) return;
  console.error(`Route error (${path}):`, err);

  appRoot.replaceChildren();
  const message = document.createElement('div');
  message.className = 'card';
  message.style.cssText = 'padding:2rem;margin:2rem;max-width:32rem';

  const heading = document.createElement('h2');
  heading.textContent = 'Something went wrong';

  const detail = document.createElement('p');
  detail.textContent = 'The page could not load. You can try again or return to the home screen.';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:0.75rem;margin-top:1.25rem;flex-wrap:wrap';

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn-primary';
  retryBtn.textContent = 'Try again';
  retryBtn.addEventListener('click', () => {
    void navigate(path);
  });

  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.className = 'btn btn-secondary';
  homeBtn.textContent = 'Go to home screen';
  homeBtn.addEventListener('click', () => {
    clearActivePersona();
    void navigate('/');
  });

  actions.append(retryBtn, homeBtn);
  message.append(heading, detail, actions);
  appRoot.append(message);
}

export async function navigate(path: string): Promise<void> {
  if (!appRoot) return;

  const token = ++navigationToken;
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

  if (!handler) return;

  appRoot.replaceChildren();
  try {
    await handler();
  } catch (err) {
    if (token !== navigationToken) return;
    renderRouteError(path, err);
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
