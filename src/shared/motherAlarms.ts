import { api } from './api';
import { icon } from './icons';
import { getCurrentRoute } from './router';
import type { MotherAlarm } from './types';
import { el, todayISO } from './utils';

const MOTHER_HUB_ROUTE = '/mother';
/** Synthetic alarm used by the temporary hub “test sound” control only. */
const MOTHER_ALARM_SOUND_TEST_ID = '__mother-alarm-sound-test__';

const DISMISS_STORAGE_KEY = 'moms-care-alarm-dismissed';
const TICK_MS = 15_000;
const ALARM_BEEP_MS = 320;
const ALARM_PAUSE_MS = 140;
const ALARM_GAIN = 0.28;

let alarms: MotherAlarm[] = [];
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

function readDismissed(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDismissed(map: Record<string, string>): void {
  localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map));
}

function isDismissedToday(alarmId: string): boolean {
  return readDismissed()[alarmId] === todayISO();
}

function markDismissedToday(alarmId: string): void {
  const map = readDismissed();
  map[alarmId] = todayISO();
  writeDismissed(map);
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
  if (isDismissedToday(alarm.id)) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
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
    if (alarm.id !== MOTHER_ALARM_SOUND_TEST_ID) {
      markDismissedToday(alarm.id);
    }
    removeOverlay();
    void checkAlarms();
  };

  panel.querySelector('#mother-alarm-ok')?.addEventListener('click', dismiss);
}

function pickNextAlarm(now: Date): MotherAlarm | null {
  const due = alarms
    .filter((a) => shouldFire(a, now))
    .sort((a, b) => parseTimeMinutes(a.time_of_day) - parseTimeMinutes(b.time_of_day));
  return due[0] ?? null;
}

function checkAlarms(): void {
  if (!canShowMotherAlarms()) {
    if (activeOverlay) removeOverlay();
    return;
  }
  const now = new Date();
  if (showingAlarmId && activeOverlay) return;
  const next = pickNextAlarm(now);
  if (next) showAlarmOverlay(next);
}

export function setMotherAlarmList(list: MotherAlarm[]): void {
  alarms = list.filter((a) => a.active);
  if (showingAlarmId && showingAlarmId !== MOTHER_ALARM_SOUND_TEST_ID) {
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
  }
}

/** Temporary dev helper: full alarm overlay + beeps (trigger from a user click). */
export function previewMotherAlarmSoundForTesting(): void {
  if (!canShowMotherAlarms()) return;
  showAlarmOverlay({
    id: MOTHER_ALARM_SOUND_TEST_ID,
    title: 'Alarm test',
    message: 'If you hear beeping, alarm sound is working.',
    time_of_day: '00:00',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    active: true,
    created_by: null,
    created_at: new Date().toISOString(),
  });
}

export function teardownMotherAlarmService(): void {
  motherHubAlarmSurfaceActive = false;
  teardownMotherHubAlarmAudioUnlock();
  serviceStarted = false;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  removeOverlay();
  disposeMotherAlarmAudio();
  alarms = [];
}
