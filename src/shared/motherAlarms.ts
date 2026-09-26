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

let alarms: MotherAlarm[] = [];
let serviceStarted = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let alarmBeepTimer: ReturnType<typeof setInterval> | null = null;
let alarmAudioContext: AudioContext | null = null;
let alarmGainNode: GainNode | null = null;
let alarmBeepStep = 0;
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

function playAlarmBeep(frequency: number): void {
  if (!alarmAudioContext || !alarmGainNode) return;
  const ctx = alarmAudioContext;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = frequency;
  osc.connect(alarmGainNode);
  const start = ctx.currentTime;
  const duration = ALARM_BEEP_MS / 1000;
  osc.start(start);
  osc.stop(start + duration);
}

function startAlarmSound(): void {
  stopAlarmSound();
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = ALARM_GAIN;
    gain.connect(ctx.destination);
    alarmAudioContext = ctx;
    alarmGainNode = gain;
    alarmBeepStep = 0;

    const runBeep = () => {
      const frequencies = [880, 698, 880, 523];
      playAlarmBeep(frequencies[alarmBeepStep % frequencies.length]);
      alarmBeepStep += 1;
    };

    void ctx.resume().then(() => {
      runBeep();
      alarmBeepTimer = setInterval(runBeep, ALARM_BEEP_MS + ALARM_PAUSE_MS);
    });
  } catch {
    // Audio may be blocked until user interaction; alarm UI still shows.
  }
}

function stopAlarmSound(): void {
  if (alarmBeepTimer) {
    clearInterval(alarmBeepTimer);
    alarmBeepTimer = null;
  }
  if (alarmAudioContext) {
    void alarmAudioContext.close();
    alarmAudioContext = null;
  }
  alarmGainNode = null;
  alarmBeepStep = 0;
}

function removeOverlay(): void {
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

  startAlarmSound();
  overlay.addEventListener('pointerdown', () => {
    if (!alarmBeepTimer) startAlarmSound();
    else void alarmAudioContext?.resume();
  }, { once: true });

  const dismiss = () => {
    markDismissedToday(alarm.id);
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

export function teardownMotherAlarmService(): void {
  motherHubAlarmSurfaceActive = false;
  serviceStarted = false;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  removeOverlay();
  alarms = [];
}
