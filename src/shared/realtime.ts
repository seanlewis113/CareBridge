import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabase';

export type DataTopic = 'tasks' | 'task_assignments' | 'mother_hub' | 'recurring_checks' | 'responsibility_areas' | 'prescriptions';

const localListeners = new Map<DataTopic, Set<() => void>>();

export function notifyLocalDataChange(topic: DataTopic): void {
  localListeners.get(topic)?.forEach((listener) => listener());
  if (topic === 'tasks' || topic === 'task_assignments' || topic === 'responsibility_areas') {
    localListeners.get('mother_hub')?.forEach((listener) => listener());
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function subscribeLocal(topic: DataTopic, callback: () => void): () => void {
  if (!localListeners.has(topic)) {
    localListeners.set(topic, new Set());
  }
  localListeners.get(topic)!.add(callback);
  return () => {
    localListeners.get(topic)?.delete(callback);
  };
}

function subscribePostgresTables(
  channelName: string,
  tables: readonly string[],
  onChange: () => void
): () => void {
  const debounced = debounce(onChange, 300);
  const cleanups: Array<() => void> = [];

  if (!isSupabaseConfigured) {
    return () => undefined;
  }

  const supabase = getSupabase();
  let channel: RealtimeChannel = supabase.channel(channelName);
  for (const table of tables) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      debounced
    );
  }

  channel.subscribe();

  cleanups.push(() => {
    void supabase.removeChannel(channel);
  });

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

const MOTHER_HUB_TABLES = [
  'tasks',
  'task_assignments',
  'profiles',
  'calendar_events',
  'reminders',
  'financial_accounts',
  'responsibility_areas',
  'responsibility_assignments',
] as const;

const TASK_TABLES = [
  'tasks',
  'task_assignments',
  'recurring_checks',
  'recurring_check_completions',
  'responsibility_areas',
  'responsibility_assignments',
  'prescriptions',
  'prescription_doses',
] as const;

export function subscribeMotherHubChanges(onChange: () => void): () => void {
  const debounced = debounce(onChange, 300);
  const cleanups = [
    subscribeLocal('mother_hub', debounced),
    subscribePostgresTables('mother-hub-changes', MOTHER_HUB_TABLES, onChange),
  ];

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export function subscribeTaskChanges(onChange: () => void): () => void {
  const debounced = debounce(onChange, 300);
  const cleanups = [
    subscribeLocal('tasks', debounced),
    subscribeLocal('task_assignments', debounced),
    subscribeLocal('recurring_checks', debounced),
    subscribeLocal('prescriptions', debounced),
    subscribeLocal('responsibility_areas', debounced),
    subscribePostgresTables('task-changes', TASK_TABLES, onChange),
  ];

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

let motherHubRealtimeCleanup: (() => void) | null = null;

export function ensureMotherHubRealtime(onChange: () => void): void {
  if (motherHubRealtimeCleanup) return;
  motherHubRealtimeCleanup = subscribeMotherHubChanges(onChange);
}

export function teardownMotherHubRealtime(): void {
  motherHubRealtimeCleanup?.();
  motherHubRealtimeCleanup = null;
}

let taskRealtimeCleanup: (() => void) | null = null;

export function ensureTaskRealtime(onChange: () => void): void {
  if (taskRealtimeCleanup) return;
  taskRealtimeCleanup = subscribeTaskChanges(onChange);
}

export function teardownTaskRealtime(): void {
  taskRealtimeCleanup?.();
  taskRealtimeCleanup = null;
}
