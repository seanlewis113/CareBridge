import './styles/global.css';
import './styles/clock-picker.css';
import './styles/landing.css';
import './styles/calendar.css';
import './styles/mother.css';
import './styles/admin.css';

import { initRouter, registerRoute, navigate, getCurrentRoute, showBootError } from './shared/router';
import { isAdmin, isAdminProfile, isAuthenticated, isCaregiver, isMother, isMotherPinVerified, handleAuthSignedOut, getSession, signOut } from './shared/auth';
import { isSupabaseConfigured, getSupabase } from './shared/supabase';
import { renderLanding, renderModuleSelect } from './personas/landing';
import { renderMotherHub, teardownMotherHub } from './personas/mother/hub';
import { teardownTaskRealtime } from './shared/realtime';
import { renderAdminDashboard } from './personas/admin/dashboard';
import { renderAdminTasks } from './personas/admin/tasks';
import { renderAdminCalendar } from './personas/admin/calendar';
import { renderAdminReminders } from './personas/admin/reminders';
import { renderAdminChecks } from './personas/admin/checks';
import { renderAdminPrescriptions } from './personas/admin/prescriptions';
import { renderAdminResponsibility } from './personas/admin/responsibility';
import { renderAdminFinance } from './personas/admin/finance';
import { renderAdminDocuments } from './personas/admin/documents';
import { renderAdminVisits } from './personas/admin/visits';
import { renderAdminSettings } from './personas/admin/settings';
import { renderAdminUsers } from './personas/admin/users';
import { renderAdminActivity } from './personas/admin/activity';
import { renderCaregiverToday } from './personas/caregiver/today';
import { renderCaregiverCalendar } from './personas/caregiver/calendar';
import { renderCaregiverTasks } from './personas/caregiver/tasks';
import { renderCaregiverVisitForm } from './personas/caregiver/visit';
import { renderCaregiverPrescriptionsPage } from './personas/caregiver/prescriptions';
import { renderCaregiverNotes } from './personas/caregiver/notes';
import { renderCaregiverDocuments } from './personas/caregiver/documents';
import { api } from './shared/api';
import { mountVersionBadge } from './shared/version';

const STALE_RECOVERY_KEY = 'moms-care-stale-recovery-attempted';

function isStaleAssetError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const normalized = message.toLowerCase();
  return (
    normalized.includes('failed to fetch dynamically imported module') ||
    normalized.includes('importing a module script failed') ||
    normalized.includes('loading chunk') ||
    normalized.includes('chunkloaderror')
  );
}

async function recoverFromStaleClient(reason: unknown): Promise<boolean> {
  if (!import.meta.env.PROD) return false;
  if (!isStaleAssetError(reason)) return false;
  if (sessionStorage.getItem(STALE_RECOVERY_KEY) === '1') return false;

  try {
    sessionStorage.setItem(STALE_RECOVERY_KEY, '1');
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
    window.location.reload();
    return true;
  } catch (recoveryError) {
    console.warn('Stale client recovery failed:', recoveryError);
    return false;
  }
}

async function guardMother(): Promise<boolean> {
  if (!isMother() || !isMotherPinVerified()) {
    await navigate('/');
    return false;
  }
  return true;
}

async function guardAdmin(): Promise<boolean> {
  if (!isAdmin() || !isAuthenticated() || !isAdminProfile()) {
    await navigate('/');
    return false;
  }
  if (isSupabaseConfigured) {
    const { data } = await getSupabase().auth.getSession();
    if (!data.session?.user) {
      await signOut();
      await navigate('/');
      return false;
    }
  }
  return true;
}

async function guardCaregiver(): Promise<boolean> {
  if (!isCaregiver() || !isAuthenticated()) {
    await navigate('/');
    return false;
  }

  const { profile, persona } = getSession();
  if (profile?.persona === 'admin') return true;
  if (profile?.persona === persona) return true;

  await navigate('/');
  return false;
}

async function guardModuleSelect(): Promise<boolean> {
  if (!isAuthenticated()) {
    await navigate('/');
    return false;
  }
  return true;
}

function registerRoutes(): void {
  registerRoute('/', () => renderLanding());
  registerRoute('/select', async () => {
    if (!(await guardModuleSelect())) return;
    await renderModuleSelect();
  });

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

  registerRoute('/admin/responsibility', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminResponsibility();
  });

  registerRoute('/admin/calendar', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminCalendar();
  });

  registerRoute('/admin/reminders', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminReminders();
  });

  registerRoute('/admin/checks', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminChecks();
  });

  registerRoute('/admin/prescriptions', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminPrescriptions();
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

  registerRoute('/admin/activity', async () => {
    if (!(await guardAdmin())) return;
    await renderAdminActivity();
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

  registerRoute('/caregiver/prescriptions', async () => {
    if (!(await guardCaregiver())) return;
    await renderCaregiverPrescriptionsPage();
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
    const oauthError = params.get('error');
    if (oauthError) {
      sessionStorage.setItem('google-oauth-error', params.get('error_description') ?? oauthError);
    } else if (code) {
      try {
        const { isSupabaseConfigured, getSupabase } = await import('./shared/supabase');
        if (isSupabaseConfigured) {
          const { data, error } = await getSupabase().functions.invoke('google-calendar-sync', {
            body: { action: 'oauth', code, redirect_uri: `${window.location.origin}/google-callback` },
          });
          const payload = (data ?? {}) as { error?: string };
          if (payload.error) {
            sessionStorage.setItem('google-oauth-error', payload.error);
          } else if (error) {
            sessionStorage.setItem('google-oauth-error', error.message);
          } else {
            sessionStorage.setItem('google-oauth-success', '1');
            await api.logActivity('calendar.oauth_connect');
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'OAuth setup failed';
        sessionStorage.setItem('google-oauth-error', message);
        console.warn('Google OAuth callback failed:', message);
      }
    }
    window.location.hash = '/admin/settings';
    await navigate('/admin/settings');
  });
}

function initAuthListener(): void {
  if (!isSupabaseConfigured) return;

  getSupabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      handleAuthSignedOut();
      if (getCurrentRoute() !== '/') {
        navigate('/');
      }
    }
  });
}

async function init(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  initAuthListener();

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
  initRouter(app, (path) => {
    if (!path.startsWith('/mother')) {
      teardownMotherHub();
    }
    if (!path.startsWith('/caregiver')) {
      teardownTaskRealtime();
    }
  });

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

  // Clear one-time stale recovery lock only after boot succeeds.
  sessionStorage.removeItem(STALE_RECOVERY_KEY);
}

init().catch(showBootError);

window.addEventListener('unhandledrejection', (event) => {
  void recoverFromStaleClient(event.reason).then((recovered) => {
    if (recovered) return;
    const app = document.getElementById('app');
    if (app && app.childElementCount === 0) {
      showBootError(event.reason);
      event.preventDefault();
    }
  });
});

window.addEventListener('error', (event) => {
  void recoverFromStaleClient(event.error ?? event.message).then((recovered) => {
    if (recovered) return;
    const app = document.getElementById('app');
    if (app && app.childElementCount === 0) {
      showBootError(event.error ?? event.message);
    }
  });
});

