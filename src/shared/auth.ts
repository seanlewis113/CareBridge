import type { Persona, Profile, SessionState } from './types';
import { api } from './api';
import { hashPin, verifyPin } from './utils';
import { isSupabaseConfigured, getSupabase } from './supabase';

const SESSION_KEY = 'moms-care-session';
const FINANCIAL_TIMEOUT_MS = 15 * 60 * 1000;

type SessionListener = (session: SessionState) => void;

let session: SessionState = loadSession();
const listeners = new Set<SessionListener>();

function setSessionFromProfile(profile: Profile | null): void {
  session = {
    persona: profile?.persona ?? null,
    profile,
    motherDeviceMode: false,
    financialUnlockedUntil: null,
  };
  saveSession();
}

function loadSession(): SessionState {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as SessionState;
  } catch {
    // fall through
  }
  return { persona: null, profile: null, motherDeviceMode: false, financialUnlockedUntil: null };
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

export async function inviteUserByAdmin(
  email: string,
  displayName: string,
  persona: Extract<Persona, 'family_caregiver' | 'hired_caregiver' | 'admin'>
): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Invites are only available when Supabase is configured.');
  }

  const { error } = await getSupabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
      emailRedirectTo: window.location.origin,
      data: {
        display_name: displayName.trim(),
        persona,
      },
    },
  });
  if (error) throw error;
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

export async function signInAsPersona(persona: Persona, pin?: string): Promise<boolean> {
  if (persona === 'mother') {
    const settings = await api.getSettings();
    const valid = await verifyPin(pin ?? '', settings.mother_pin_hash);
    if (!valid) return false;
    session = {
      persona: 'mother',
      profile: null,
      motherDeviceMode: true,
      financialUnlockedUntil: null,
    };
    saveSession();
    return true;
  }

  if (!pin) return false;
  const settings = await api.getSettings();
  const valid = await verifyPin(pin, settings.admin_switch_pin_hash);
  if (!valid) return false;

  if (persona === 'admin') {
    const profiles = await api.getProfiles();
    const admin = profiles.find((p) => p.persona === 'admin');
    session = {
      persona: 'admin',
      profile: admin ?? null,
      motherDeviceMode: false,
      financialUnlockedUntil: null,
    };
    saveSession();
    return true;
  }

  const profiles = await api.getProfiles();
  const profile = profiles.find((p) => p.persona === persona);
  if (!profile) return false;
  session = {
    persona,
    profile,
    motherDeviceMode: false,
    financialUnlockedUntil: null,
  };
  saveSession();
  return true;
}

export function signOut(): void {
  if (isSupabaseConfigured) {
    getSupabase().auth.signOut();
  }
  session = { persona: null, profile: null, motherDeviceMode: false, financialUnlockedUntil: null };
  saveSession();
}

export async function setMotherPin(pin: string): Promise<void> {
  const hash = await hashPin(pin);
  await api.updateSettings({ mother_pin_hash: hash });
}

export async function setAdminSwitchPin(pin: string): Promise<void> {
  const hash = await hashPin(pin);
  await api.updateSettings({ admin_switch_pin_hash: hash });
}

export async function setFinancialPin(pin: string): Promise<void> {
  const hash = await hashPin(pin);
  await api.updateSettings({ financial_pin_hash: hash });
}

export async function unlockFinancials(pin: string): Promise<boolean> {
  const settings = await api.getSettings();
  const valid = await verifyPin(pin, settings.financial_pin_hash);
  if (!valid) return false;
  session.financialUnlockedUntil = Date.now() + FINANCIAL_TIMEOUT_MS;
  saveSession();
  await api.logFinancialAccess(session.profile?.id ?? null, 'unlock');
  return true;
}

export function isFinancialUnlocked(): boolean {
  if (!session.financialUnlockedUntil) return false;
  if (Date.now() > session.financialUnlockedUntil) {
    session.financialUnlockedUntil = null;
    saveSession();
    return false;
  }
  return true;
}

export function lockFinancials(): void {
  session.financialUnlockedUntil = null;
  saveSession();
}

export function canAccessFinancials(): boolean {
  return session.persona === 'admin' && isFinancialUnlocked();
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
