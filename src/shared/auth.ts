import type { User } from '@supabase/supabase-js';
import type { Persona, Profile, SessionState } from './types';
import { api, setActivityContext } from './api';
import { isSupabaseConfigured, getSupabase } from './supabase';

const SESSION_KEY = 'moms-care-session';

type SessionListener = (session: SessionState) => void;

let session: SessionState = loadSession();
const listeners = new Set<SessionListener>();
syncActivityContext();

function syncActivityContext(): void {
  setActivityContext({
    profileId: session.profile?.id ?? null,
    persona: session.persona,
  });
}

function setSessionFromProfile(profile: Profile | null): void {
  session = {
    persona: profile?.persona ?? null,
    profile,
    motherDeviceMode: false,
    motherPinVerified: false,
  };
  saveSession();
  syncActivityContext();
}

function sanitizeSession(state: SessionState): SessionState {
  if (state.persona === 'mother' && !state.motherPinVerified) {
    return { persona: null, profile: state.profile, motherDeviceMode: false, motherPinVerified: false };
  }

  if (state.persona && state.persona !== 'mother' && !state.profile) {
    return { persona: null, profile: null, motherDeviceMode: false, motherPinVerified: false };
  }

  return {
    ...state,
    motherPinVerified: state.persona === 'mother' ? !!state.motherPinVerified : false,
  };
}

function loadSession(): SessionState {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return sanitizeSession(JSON.parse(raw) as SessionState);
  } catch {
    // fall through
  }
  return { persona: null, profile: null, motherDeviceMode: false, motherPinVerified: false };
}

function saveSession(): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  listeners.forEach((fn) => fn(session));
}

export function getSession(): SessionState {
  return { ...session };
}

export function subscribeSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const SETUP_PASSWORD_PATH = '/setup-password';

export function supabaseUserNeedsPasswordSetup(user: User | null | undefined): boolean {
  return user?.user_metadata?.needs_password_setup === true;
}

function isImplicitAuthHash(): boolean {
  const hash = window.location.hash.slice(1);
  return hash.includes('access_token=') || hash.includes('refresh_token=');
}

/** Parse Supabase auth callback (PKCE ?code= or legacy hash tokens) before app routing clobbers the URL. */
export async function bootstrapSupabaseSessionFromUrl(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const supabase = getSupabase();
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, cleanUrl);
    return true;
  }

  if (isImplicitAuthHash()) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session) {
      window.history.replaceState({}, document.title, `${window.location.pathname}#/`);
      return true;
    }
  }

  await supabase.auth.getSession();
  return false;
}

/** Align app sessionStorage profile with the current Supabase auth user (e.g. after magic link). */
export async function syncAppSessionWithSupabaseAuth(force = false): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;

  const { data } = await getSupabase().auth.getSession();
  const user = data.session?.user;
  if (!user) return null;

  const current = getSession().profile;
  if (!force && current?.id === user.id) return current;

  return refreshSessionFromSupabase();
}

export async function completeInvitedUserPasswordSetup(password: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Password setup requires Supabase.');
  }

  const supabase = getSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error('Not signed in.');

  const metadata = { ...(user.user_metadata ?? {}), needs_password_setup: false };
  const { error } = await supabase.auth.updateUser({ password, data: metadata });
  if (error) throw error;

  await api.logActivity('auth.password_set', { metadata: { profile_id: user.id } });
}

export async function resolvePostAuthRoutePath(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;

  const { data } = await getSupabase().auth.getSession();
  const user = data.session?.user;
  if (!user) return null;

  if (supabaseUserNeedsPasswordSetup(user)) {
    return SETUP_PASSWORD_PATH;
  }

  const profile = getSession().profile ?? (await refreshSessionFromSupabase());
  if (!profile) return '/';

  switch (profile.persona) {
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

export async function signInWithEmail(email: string, password: string): Promise<Profile | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.user) return null;
    const { data: profileData, error: profileError } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    if (profileError || !profileData) return null;
    const profile = profileData as Profile;
    setSessionFromProfile(profile);
    await api.logActivity('auth.sign_in', { metadata: { email: profile.email } });
    return profile;
  }

  const profiles = await api.getProfiles();
  const profile = profiles.find((p) => p.email === email);
  if (!profile) throw new Error('No account found for that email. Use demo mode profiles.');
  setSessionFromProfile(profile);
  return profile;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
  persona: Extract<Persona, 'family_caregiver' | 'hired_caregiver'>
): Promise<{ needsEmailConfirmation: boolean }> {
  if (!isSupabaseConfigured) {
    throw new Error('Sign up is only available when Supabase is configured.');
  }

  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        persona,
      },
    },
  });
  if (error) throw error;

  if (!data.session) {
    return { needsEmailConfirmation: true };
  }

  await refreshSessionFromSupabase();
  return { needsEmailConfirmation: false };
}

export async function createUserByAdmin(
  email: string,
  password: string,
  displayName: string,
  persona: Extract<Persona, 'family_caregiver' | 'hired_caregiver' | 'admin'>
): Promise<Profile> {
  if (!isSupabaseConfigured) {
    throw new Error('User management is only available when Supabase is configured.');
  }
  if (!(await hasSupabaseAuth())) {
    throw new Error('Sign in with your admin email and password to add users.');
  }
  if (!isAdminProfile()) {
    throw new Error('Only admins can add users.');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const { data, error } = await getSupabase().functions.invoke('create-user', {
    body: {
      email: email.trim().toLowerCase(),
      password,
      displayName: displayName.trim(),
      persona,
    },
  });

  const payload = (data ?? {}) as { error?: string; profile?: Profile };
  if (payload.error) {
    throw new Error(payload.error);
  }

  if (error) {
    const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (context?.json) {
      try {
        const errBody = await context.json();
        if (errBody?.error) throw new Error(errBody.error);
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
      }
    }
    throw new Error(error.message ?? 'Could not create user.');
  }

  if (!payload.profile) {
    throw new Error('User creation failed.');
  }

  await api.logActivity('auth.create_user', {
    metadata: { email: email.trim().toLowerCase(), display_name: displayName.trim(), persona },
  });

  return payload.profile;
}

export async function hasSupabaseAuth(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data } = await getSupabase().auth.getSession();
  return !!data.session?.user;
}

export async function refreshSessionFromSupabase(): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  if (!user) return null;
  const { data: profileData, error: profileError } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (profileError || !profileData) return null;
  const profile = profileData as Profile;
  setSessionFromProfile(profile);
  return profile;
}

export async function signInAsMotherWithPin(): Promise<boolean> {
  session = {
    persona: 'mother',
    profile: null,
    motherDeviceMode: true,
    motherPinVerified: true,
  };
  saveSession();
  syncActivityContext();
  await api.logActivity('auth.persona_switch', { metadata: { persona: 'mother' } });
  return true;
}

export async function signInAsPersona(persona: Persona): Promise<boolean> {
  if (persona === 'mother') {
    if (!isAdminProfile()) return false;
    session = {
      persona: 'mother',
      profile: session.profile,
      motherDeviceMode: false,
      motherPinVerified: true,
    };
    saveSession();
    syncActivityContext();
    await api.logActivity('auth.persona_switch', { metadata: { persona: 'mother', preview: true } });
    return true;
  }

  if (persona === 'admin') {
    if (!isAdminProfile()) return false;
    session = {
      persona: 'admin',
      profile: session.profile,
      motherDeviceMode: false,
      motherPinVerified: false,
    };
    saveSession();
    syncActivityContext();
    await api.logActivity('auth.persona_switch', { metadata: { persona: 'admin' } });
    return true;
  }

  if (persona === 'family_caregiver' || persona === 'hired_caregiver') {
    if (isAdminProfile()) {
      session = {
        persona,
        profile: session.profile,
        motherDeviceMode: false,
        motherPinVerified: false,
      };
      saveSession();
      syncActivityContext();
      await api.logActivity('auth.persona_switch', { metadata: { persona, preview: true } });
      return true;
    }
  }

  if (!session.profile || session.profile.persona !== persona) return false;

  session = {
    persona,
    profile: session.profile,
    motherDeviceMode: false,
    motherPinVerified: false,
  };
  saveSession();
  syncActivityContext();
  await api.logActivity('auth.persona_switch', { metadata: { persona } });
  return true;
}

export function restorePersonaFromProfile(): boolean {
  if (!session.profile) return false;
  session = {
    ...session,
    persona: session.profile.persona,
    motherDeviceMode: false,
    motherPinVerified: false,
  };
  saveSession();
  syncActivityContext();
  return true;
}

export function clearActivePersona(): void {
  session = {
    ...session,
    persona: null,
    motherDeviceMode: false,
    motherPinVerified: false,
  };
  saveSession();
  syncActivityContext();
}

export function isAuthenticated(): boolean {
  return session.profile !== null;
}

export function isAdminProfile(): boolean {
  return session.profile?.persona === 'admin';
}

function clearSession(): void {
  session = { persona: null, profile: null, motherDeviceMode: false, motherPinVerified: false };
  saveSession();
  syncActivityContext();
}

export function handleAuthSignedOut(): void {
  clearSession();
}

export async function signOut(): Promise<void> {
  const profileId = session.profile?.id ?? null;
  if (profileId) {
    await api.logActivity('auth.sign_out', { metadata: { profile_id: profileId } });
  }
  if (isSupabaseConfigured) {
    await getSupabase().auth.signOut();
  }
  clearSession();
}

export function canAccessFinancials(): boolean {
  return session.persona === 'admin';
}

export function isAdmin(): boolean {
  return session.persona === 'admin';
}

export function isCaregiver(): boolean {
  return session.persona === 'family_caregiver' || session.persona === 'hired_caregiver';
}

export function isMother(): boolean {
  return session.persona === 'mother';
}

export function isMotherPinVerified(): boolean {
  return session.persona === 'mother' && session.motherPinVerified === true;
}
