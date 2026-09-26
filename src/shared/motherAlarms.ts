import { api } from './api';
import { icon } from './icons';
import { getCurrentRoute } from './router';
import type { MotherAlarm } from './types';
import { el, todayISO } from './utils';

const MOTHER_HUB_ROUTE = '/mother';

const DISMISS_STORAGE_KEY = 'moms-care-alarm-dismissed';
const TICK_MS = 15_000;
const ALARM_BEEP_MS = 320;
const ALARM_PAUSE_MS = 140;
const ALARM_GAIN = 0.28;
const ALARM_MAX_DURATION_MS = 3 * 60 * 1000;

let alarmAutoStopTimer: ReturnType<typeof setTimeout> | null = null;
let alarmWakeTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityCleanup: (() => void) | null = null;

let alarms: MotherAlarm[] = [];
/** Last seen schedule per alarm id — used to clear dismiss when admin edits time/days. */
const alarmScheduleById = new Map<string, string>();
let serviceStarted = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let alarmBeepTimer: ReturnType<typeof setInterval> | null = null;
let alarmSoundRetryTimer: ReturnType<typeof setInterval> | null = null;
let sharedAudioContext: AudioContext | null = null;
let alarmBeepGain: GainNode | null = null;
let alarmBeepStep = 0;
let audioUnlockCleanup: (() => void) | null = null;
let alarmSoundHint: HTMLElement | null = null;
let activeOverlay: HTMLElement | null = null;
let showingAlarmId: string | null = null;
let motherHubAlarmSurfaceActive = false;

export function setMotherHubAlarmSurfaceActive(active: boolean): void {
  motherHubAlarmSurfaceActive = active;
  if (!active && activeOverlay) {
    removeOverlay();
  }
}

function canShowMotherAlarms(): boolean {
  return motherHubAlarmSurfaceActive && getCurrentRoute() === MOTHER_HUB_ROUTE;
}

function alarmScheduleKey(alarm: Pick<MotherAlarm, 'time_of_day' | 'days_of_week'>): string {
  const days = [...alarm.days_of_week].sort((a, b) => a - b).join(',');
  return `${alarm.time_of_day}|${days}`;
}

interface AlarmDismissRecord {
  date: string;
  schedule: string;
}

type StoredDismiss = AlarmDismissRecord | string;

function readDismissed(): Record<string, StoredDismiss> {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredDismiss>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDismissed(map: Record<string, StoredDismiss>): void {
  localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map));
}

function isDismissedToday(alarm: MotherAlarm): boolean {
  const raw = readDismissed()[alarm.id];
  if (!raw) return false;
  const today = todayISO();
  const schedule = alarmScheduleKey(alarm);
  if (typeof raw === 'string') {
    // Legacy date-only entries cannot represent a edited schedule — do not block.
    return false;
  }
  return raw.date === today && raw.schedule === schedule;
}

function markDismissedToday(alarm: MotherAlarm): void {
  const map = readDismissed();
  map[alarm.id] = { date: todayISO(), schedule: alarmScheduleKey(alarm) };
  writeDismissed(map);
}

function syncDismissalsWithAlarmSchedules(activeAlarms: MotherAlarm[]): void {
  const map = readDismissed();
  let changed = false;
  const today = todayISO();

  for (const alarm of activeAlarms) {
    const schedule = alarmScheduleKey(alarm);
    const prevSchedule = alarmScheduleById.get(alarm.id);
    if (prevSchedule !== undefined && prevSchedule !== schedule) {
      if (alarm.id in map) {
        delete map[alarm.id];
        changed = true;
      }
    }
    alarmScheduleById.set(alarm.id, schedule);

    const raw = map[alarm.id];
    if (!raw || typeof raw === 'string') continue;
    if (raw.date === today && raw.schedule !== schedule) {
      delete map[alarm.id];
      changed = true;
    }
  }

  if (changed) writeDismissed(map);
}

function parseTimeMinutes(timeOfDay: string): number {
  const [hStr, mStr] = timeOfDay.split(':');
  const hours = parseInt(hStr, 10) || 0;
  const minutes = parseInt(mStr, 10) || 0;
  return hours * 60 + minutes;
}

function formatTime12(timeOfDay: string): string {
  const [hStr, mStr] = timeOfDay.split(':');
  let hour24 = parseInt(hStr, 10) || 0;
  const minute = parseInt(mStr, 10) || 0;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function formatMotherAlarmSchedule(alarm: MotherAlarm): string {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = alarm.days_of_week.length === 7
    ? 'Every day'
    : alarm.days_of_week.map((d) => dayLabels[d]).join(', ');
  return `${formatTime12(alarm.time_of_day)} · ${days}`;
}

function shouldFire(alarm: MotherAlarm, now: Date): boolean {
  if (!alarm.active) return false;
  if (!alarm.days_of_week.includes(now.getDay() as MotherAlarm['days_of_week'][number])) {
    return false;
  }
  if (isDismissedToday(alarm)) return false;
  const nowMinutes = localNowMinutes(now);
  return nowMinutes >= parseTimeMinutes(alarm.time_of_day);
}

function getAudioContextClass(): typeof AudioContext | null {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Call during a user gesture (PIN tap, hub touch) so scheduled alarms can play sound later. */
export function unlockMotherAlarmAudio(): void {
  try {
    const AudioCtx = getAudioContextClass();
    if (!AudioCtx) return;

    if (!sharedAudioContext) {
      sharedAudioContext = new AudioCtx();
    }

    const ctx = sharedAudioContext;
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    void ctx.resume();
  } catch {
    // Ignore — alarm UI still shows.
  }
}

export function installMotherHubAlarmAudioUnlock(): void {
  audioUnlockCleanup?.();
  const onGesture = () => unlockMotherAlarmAudio();
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener('pointerdown', onGesture, opts);
  document.addEventListener('touchstart', onGesture, opts);
  document.addEventListener('keydown', onGesture, opts);
  audioUnlockCleanup = () => {
    document.removeEventListener('pointerdown', onGesture, opts);
    document.removeEventListener('touchstart', onGesture, opts);
    document.removeEventListener('keydown', onGesture, opts);
  };
}

function teardownMotherHubAlarmAudioUnlock(): void {
  audioUnlockCleanup?.();
  audioUnlockCleanup = null;
}

function isAlarmSoundActive(): boolean {
  return !!alarmBeepTimer && sharedAudioContext?.state === 'running';
}

function playAlarmBeep(frequency: number): void {
  if (!sharedAudioContext || !alarmBeepGain) return;
  const ctx = sharedAudioContext;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = frequency;
  osc.connect(alarmBeepGain);
  const start = ctx.currentTime;
  const duration = ALARM_BEEP_MS / 1000;
  osc.start(start);
  osc.stop(start + duration);
}

function pulseVibrate(): void {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate([280, 120, 280, 120, 280]);
  }
}

function clearAlarmSoundRetryTimer(): void {
  if (alarmSoundRetryTimer) {
    clearInterval(alarmSoundRetryTimer);
    alarmSoundRetryTimer = null;
  }
}

function clearAlarmAutoStopTimer(): void {
  if (alarmAutoStopTimer) {
    clearTimeout(alarmAutoStopTimer);
    alarmAutoStopTimer = null;
  }
}

function clearAlarmWakeTimer(): void {
  if (alarmWakeTimer) {
    clearTimeout(alarmWakeTimer);
    alarmWakeTimer = null;
  }
}

function localNowMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

function msUntilNextMinuteBoundary(now: Date): number {
  return Math.max(250, (60 - now.getSeconds()) * 1000 - now.getMilliseconds());
}

/** Soonest future fire time today for an active, not-yet-due alarm (local clock). */
function msUntilNextAlarmFire(now: Date): number | null {
  const day = now.getDay() as MotherAlarm['days_of_week'][number];
  const nowMinutes = localNowMinutes(now);
  const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();
  let soonest: number | null = null;

  for (const alarm of alarms) {
    if (!alarm.active) continue;
    if (!alarm.days_of_week.includes(day)) continue;
    if (isDismissedToday(alarm)) continue;
    const alarmMinutes = parseTimeMinutes(alarm.time_of_day);
    if (alarmMinutes <= nowMinutes) continue;
    const ms = (alarmMinutes - nowMinutes) * 60 * 1000 - msIntoMinute;
    if (soonest === null || ms < soonest) soonest = ms;
  }

  return soonest;
}

function scheduleNextAlarmCheck(): void {
  clearAlarmWakeTimer();
  if (!canShowMotherAlarms()) return;

  const now = new Date();
  const candidates = [msUntilNextMinuteBoundary(now), msUntilNextAlarmFire(now), TICK_MS]
    .filter((ms): ms is number => ms != null);
  const delay = Math.min(...candidates);

  alarmWakeTimer = setTimeout(() => {
    checkAlarms();
    scheduleNextAlarmCheck();
  }, delay);
}

async function refreshMotherAlarmsFromServer(): Promise<void> {
  if (!canShowMotherAlarms()) return;
  try {
    const list = await api.getMotherAlarms();
    if (!canShowMotherAlarms()) return;
    setMotherAlarmList(list);
  } catch (err) {
    console.warn('Could not refresh mother alarms:', err);
  }
}

function installMotherAlarmWakeHandlers(): void {
  visibilityCleanup?.();
  const onResume = () => {
    if (document.visibilityState === 'hidden') return;
    if (!canShowMotherAlarms()) return;
    void refreshMotherAlarmsFromServer();
    checkAlarms();
    scheduleNextAlarmCheck();
  };
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('focus', onResume);
  window.addEventListener('pageshow', onResume);
  visibilityCleanup = () => {
    document.removeEventListener('visibilitychange', onResume);
    window.removeEventListener('focus', onResume);
    window.removeEventListener('pageshow', onResume);
  };
}

function teardownMotherAlarmWakeHandlers(): void {
  visibilityCleanup?.();
  visibilityCleanup = null;
  clearAlarmWakeTimer();
}

function stopAlarmBeepsOnly(): void {
  if (alarmBeepTimer) {
    clearInterval(alarmBeepTimer);
    alarmBeepTimer = null;
  }
  alarmBeepGain?.disconnect();
  alarmBeepGain = null;
  alarmBeepStep = 0;
  alarmSoundHint?.remove();
  alarmSoundHint = null;
}

function updateAlarmSoundHint(overlay: HTMLElement): void {
  if (isAlarmSoundActive()) {
    alarmSoundHint?.remove();
    alarmSoundHint = null;
    return;
  }
  if (alarmSoundHint) return;
  alarmSoundHint = el('p', { className: 'mother-alarm-sound-hint' }, 'Tap anywhere on the screen if you don\'t hear the alarm.');
  overlay.querySelector('.mother-alarm-panel')?.append(alarmSoundHint);
}

function beginAlarmBeeps(): void {
  if (!sharedAudioContext || alarmBeepTimer) return;

  const gain = sharedAudioContext.createGain();
  gain.gain.value = ALARM_GAIN;
  gain.connect(sharedAudioContext.destination);
  alarmBeepGain = gain;
  alarmBeepStep = 0;

  const runBeep = () => {
    const frequencies = [880, 698, 880, 523];
    playAlarmBeep(frequencies[alarmBeepStep % frequencies.length]);
    alarmBeepStep += 1;
    pulseVibrate();
  };

  runBeep();
  alarmBeepTimer = setInterval(runBeep, ALARM_BEEP_MS + ALARM_PAUSE_MS);
}

function startAlarmSound(overlay?: HTMLElement): void {
  if (alarmBeepTimer) return;
  unlockMotherAlarmAudio();

  const ctx = sharedAudioContext;
  if (!ctx) {
    if (overlay) updateAlarmSoundHint(overlay);
    return;
  }

  const start = () => {
    if (ctx.state !== 'running') {
      if (overlay) updateAlarmSoundHint(overlay);
      return;
    }
    beginAlarmBeeps();
    if (overlay) updateAlarmSoundHint(overlay);
  };

  if (ctx.state === 'running') {
    start();
  } else {
    void ctx.resume().then(start).catch(() => {
      if (overlay) updateAlarmSoundHint(overlay);
    });
  }
}

function stopAlarmSound(): void {
  stopAlarmBeepsOnly();
}

function disposeMotherAlarmAudio(): void {
  clearAlarmSoundRetryTimer();
  stopAlarmBeepsOnly();
  if (sharedAudioContext) {
    void sharedAudioContext.close();
    sharedAudioContext = null;
  }
}

function removeOverlay(): void {
  clearAlarmAutoStopTimer();
  clearAlarmSoundRetryTimer();
  activeOverlay?.remove();
  activeOverlay = null;
  showingAlarmId = null;
  stopAlarmSound();
  document.body.classList.remove('mother-alarm-open');
}

function showAlarmOverlay(alarm: MotherAlarm): void {
  if (showingAlarmId === alarm.id && activeOverlay) return;

  removeOverlay();
  showingAlarmId = alarm.id;

  const overlay = el('div', {
    className: 'mother-alarm-overlay',
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-labelledby': 'mother-alarm-title',
  });

  const panel = el('div', { className: 'mother-alarm-panel' },
    el('div', { className: 'mother-alarm-icon', 'aria-hidden': 'true' }, icon('bell')),
    el('h2', { id: 'mother-alarm-title', className: 'mother-alarm-title' }, alarm.title),
    alarm.message
      ? el('p', { className: 'mother-alarm-message' }, alarm.message)
      : null,
    el('button', {
      className: 'btn btn-primary mother-alarm-ok',
      type: 'button',
      id: 'mother-alarm-ok',
    }, 'OK, got it')
  );

  overlay.append(panel);
  document.body.append(overlay);
  document.body.classList.add('mother-alarm-open');
  activeOverlay = overlay;

  startAlarmSound(overlay);

  const retrySound = () => {
    unlockMotherAlarmAudio();
    if (!isAlarmSoundActive()) startAlarmSound(overlay);
    else updateAlarmSoundHint(overlay);
  };

  overlay.addEventListener('pointerdown', retrySound, { capture: true });
  alarmSoundRetryTimer = setInterval(retrySound, 900);

  const dismiss = () => {
    markDismissedToday(alarm);
    removeOverlay();
    void checkAlarms();
  };

  panel.querySelector('#mother-alarm-ok')?.addEventListener('click', dismiss);

  clearAlarmAutoStopTimer();
  alarmAutoStopTimer = setTimeout(dismiss, ALARM_MAX_DURATION_MS);
}

function pickNextAlarm(now: Date): MotherAlarm | null {
  const due = alarms
    .filter((a) => shouldFire(a, now))
    .sort((a, b) => parseTimeMinutes(a.time_of_day) - parseTimeMinutes(b.time_of_day));
  return due[0] ?? null;
}

function checkAlarms(): void {
  if (!canShowMotherAlarms()) {
    return;
  }
  const now = new Date();
  if (showingAlarmId && activeOverlay) return;
  const next = pickNextAlarm(now);
  if (next) showAlarmOverlay(next);
  scheduleNextAlarmCheck();
}

export function setMotherAlarmList(list: MotherAlarm[]): void {
  const active = list.filter((a) => a.active);
  syncDismissalsWithAlarmSchedules(active);
  alarms = active;
  if (showingAlarmId) {
    const current = alarms.find((a) => a.id === showingAlarmId);
    const now = new Date();
    if (!current || !shouldFire(current, now)) {
      removeOverlay();
    }
  }
  checkAlarms();
}

export async function ensureMotherAlarmService(): Promise<void> {
  if (!canShowMotherAlarms()) return;

  installMotherHubAlarmAudioUnlock();
  installMotherAlarmWakeHandlers();

  if (!serviceStarted) {
    serviceStarted = true;
    tickTimer = setInterval(() => checkAlarms(), TICK_MS);
  }
  try {
    const list = await api.getMotherAlarms();
    if (!canShowMotherAlarms()) return;
    setMotherAlarmList(list);
  } catch (err) {
    console.warn('Could not load mother alarms:', err);
    alarms = [];
    scheduleNextAlarmCheck();
  }
}

export function teardownMotherAlarmService(): void {
  motherHubAlarmSurfaceActive = false;
  teardownMotherHubAlarmAudioUnlock();
  teardownMotherAlarmWakeHandlers();
  serviceStarted = false;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  removeOverlay();
  disposeMotherAlarmAudio();
  alarms = [];
  alarmScheduleById.clear();
}
