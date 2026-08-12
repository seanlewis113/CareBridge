import './styles/global.css';
import './styles/clock-picker.css';
import './styles/landing.css';
import './styles/mother.css';
import './styles/admin.css';

import { initRouter, registerRoute, navigate, getCurrentRoute } from './shared/router';
import { isAdmin, isCaregiver, isMother } from './shared/auth';
import { renderLanding, renderModuleSelect } from './personas/landing';
import { renderMotherHub } from './personas/mother/hub';
import { renderAdminDashboard } from './personas/admin/dashboard';
import { renderAdminTasks } from './personas/admin/tasks';
import { renderAdminCalendar } from './personas/admin/calendar';
import { renderAdminReminders } from './personas/admin/reminders';
import { renderAdminFinance } from './personas/admin/finance';
import { renderAdminDocuments } from './personas/admin/documents';
import { renderAdminVisits } from './personas/admin/visits';
import { renderAdminSettings } from './personas/admin/settings';
import { renderAdminUsers } from './personas/admin/users';
import { renderCaregiverToday } from './personas/caregiver/today';
import { renderCaregiverCalendar } from './personas/caregiver/calendar';
import { renderCaregiverTasks } from './personas/caregiver/tasks';
import { renderCaregiverVisitForm } from './personas/caregiver/visit';
import { renderCaregiverNotes } from './personas/caregiver/notes';
import { renderCaregiverDocuments } from './personas/caregiver/documents';
import { api } from './shared/api';
import { mountVersionBadge } from './shared/version';

async function guardMother(): Promise<boolean> {
  if (!isMother()) {
    await navigate('/');
    return false;
  }
  return true;
}

async function guardAdmin(): Promise<boolean> {
  if (!isAdmin()) {
    await navigate('/');
    return false;
  }
  return true;
}

async function guardCaregiver(): Promise<boolean> {
  if (!isCaregiver()) {
    await navigate('/');
    return false;
  }
  return true;
}

function registerRoutes(): void {
  registerRoute('/', () => renderLanding());
  registerRoute('/select', () => renderModuleSelect());

  registerRoute('/mother', async () => {
    if (!(await guardMother())) return;
    const settings = await api.getSettings();
    document.documentElement.style.setProperty('--text-scale', String(settings.text_scale));
    await renderMotherHub();
  });

  registerRoute('/admin', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminDashboard();
  });

  registerRoute('/admin/tasks', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminTasks();
  });

  registerRoute('/admin/calendar', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminCalendar();
  });

  registerRoute('/admin/reminders', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminReminders();
  });

  registerRoute('/admin/finance', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminFinance();
  });

  registerRoute('/admin/documents', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminDocuments();
  });

  registerRoute('/admin/visits', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminVisits();
  });

  registerRoute('/admin/users', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminUsers();
  });

  registerRoute('/admin/settings', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminSettings();
  });

  registerRoute('/caregiver', async () => {
    if (!(await guardCaregiver())) return;
    await renderCaregiverToday();
  });

  registerRoute('/caregiver/calendar', async () => {
    if (!(await guardCaregiver())) return;
    await renderCaregiverCalendar();
  });

  registerRoute('/caregiver/tasks', async () => {
    if (!(await guardCaregiver())) return;
    await renderCaregiverTasks();
  });

  registerRoute('/caregiver/visit', async () => {
    if (!(await guardCaregiver())) return;
    await renderCaregiverVisitForm();
  });

  registerRoute('/caregiver/notes', async () => {
    if (!(await guardCaregiver())) return;
    await renderCaregiverNotes();
  });

  registerRoute('/caregiver/documents', async () => {
    if (!(await guardCaregiver())) return;
    await renderCaregiverDocuments();
  });

  registerRoute('/google-callback', async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      try {
        const { isSupabaseConfigured, getSupabase } = await import('./shared/supabase');
        if (isSupabaseConfigured) {
          await getSupabase().functions.invoke('google-calendar-sync', {
            body: { action: 'oauth', code, redirect_uri: `${window.location.origin}/google-callback` },
          });
        }
      } catch {
        console.warn('Google OAuth callback — configure Supabase edge function to complete setup.');
      }
    }
    window.location.hash = '/admin/settings';
    await navigate('/admin/settings');
  });
}

async function init(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  if (!import.meta.env.PROD && 'serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
  }

  mountVersionBadge();

  registerRoutes();
  initRouter(app);

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  }

  const path = getCurrentRoute();
  if (path === '/google-callback' || window.location.pathname.includes('google-callback')) {
    await navigate('/google-callback');
  } else {
    await navigate(path || '/');
  }
}

init();
