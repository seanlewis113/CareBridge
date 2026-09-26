import { api } from './api';
import { icon } from './icons';
import type { MotherAlarm } from './types';
import { el, todayISO } from './utils';

const DISMISS_STORAGE_KEY = 'moms-care-alarm-dismissed';
const TICK_MS = 15_000;
const CHIME_REPEAT_MS = 45_000;

let alarms: MotherAlarm[] = [];
let serviceStarted = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let chimeTimer: ReturnType<typeof setInterval> | null = null;
let activeOverlay: HTMLElement | null = null;
let showingAlarmId: string | null = null;

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

function playChime(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc.stop(ctx.currentTime + 0.9);
    window.setTimeout(() => void ctx.close(), 1200);
  } catch {
    // Audio may be blocked until user interaction; alarm UI still shows.
  }
}

function clearChimeTimer(): void {
  if (chimeTimer) {
    clearInterval(chimeTimer);
    chimeTimer = null;
  }
}

function removeOverlay(): void {
  activeOverlay?.remove();
  activeOverlay = null;
  showingAlarmId = null;
  clearChimeTimer();
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

  playChime();
  chimeTimer = setInterval(() => playChime(), CHIME_REPEAT_MS);

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
  if (!serviceStarted) {
    serviceStarted = true;
    tickTimer = setInterval(() => checkAlarms(), TICK_MS);
  }
  try {
    const list = await api.getMotherAlarms();
    setMotherAlarmList(list);
  } catch (err) {
    console.warn('Could not load mother alarms:', err);
    alarms = [];
  }
}

export function teardownMotherAlarmService(): void {
  serviceStarted = false;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  removeOverlay();
  alarms = [];
}
