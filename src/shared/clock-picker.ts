import { el } from './utils';

export interface ClockPickerOptions {
  id: string;
  value?: string;
  required?: boolean;
  large?: boolean;
  label?: string;
  placeholder?: string;
}

export interface ClockPicker {
  element: HTMLElement;
  getValue: () => string;
  setValue: (value: string) => void;
}

type Period = 'AM' | 'PM';
type Step = 'hour' | 'minute';

interface TimeState {
  hour12: number;
  minute: number;
  period: Period;
}

interface ActivePicker {
  hiddenInput: HTMLInputElement;
  trigger: HTMLButtonElement;
  modalLabel: string;
  onCommit: () => void;
}

const HOUR_LABELS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTE_LABELS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

let modalRoot: HTMLElement | null = null;
let clockOverlay: HTMLElement | null = null;
let ampmOverlay: HTMLElement | null = null;
let cpFace: HTMLElement | null = null;
let cpHand: HTMLElement | null = null;
let cpDispH: HTMLElement | null = null;
let cpDispM: HTMLElement | null = null;
let cpHint: HTMLElement | null = null;
let cpLabel: HTMLElement | null = null;
let apTime: HTMLElement | null = null;

let activePicker: ActivePicker | null = null;
let step: Step = 'hour';
let state: TimeState = { hour12: 10, minute: 0, period: 'AM' };
let dragging = false;
let modalReady = false;

function parseTime24(value: string): TimeState {
  const [hStr, mStr] = value.split(':');
  const hour24 = Math.min(23, Math.max(0, parseInt(hStr, 10) || 0));
  const minute = snapMinute(Math.min(59, Math.max(0, parseInt(mStr, 10) || 0)));
  const period: Period = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, period };
}

function toTime24(s: TimeState): string {
  let hour24 = s.hour12 % 12;
  if (s.period === 'PM') hour24 += 12;
  return `${String(hour24).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
}

function formatDisplay(s: TimeState): string {
  return `${s.hour12}:${String(s.minute).padStart(2, '0')} ${s.period}`;
}

function setTriggerState(
  trigger: HTMLButtonElement,
  value: string,
  placeholder: string,
  clearBtn: HTMLButtonElement,
): void {
  if (!value) {
    trigger.textContent = placeholder;
    trigger.classList.add('clock-picker-trigger-empty');
    trigger.setAttribute('aria-label', `${placeholder}, tap to set time`);
    clearBtn.hidden = true;
    return;
  }

  const parsed = parseTime24(value);
  const display = formatDisplay(parsed);
  trigger.textContent = display;
  trigger.classList.remove('clock-picker-trigger-empty');
  trigger.setAttribute('aria-label', `Selected time ${display}, tap to change`);
  clearBtn.hidden = false;
}

function snapMinute(minute: number): number {
  return Math.round(minute / 5) * 5 % 60;
}

function handDeg(value: number, max: number): number {
  return (value / max) * 360;
}

function placeNums(container: HTMLElement, values: (string | number)[], selected: number): void {
  container.querySelectorAll('.cp-num').forEach((n) => n.remove());
  const count = values.length;
  values.forEach((val, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    const num = el('span', { className: 'cp-num', 'data-val': String(val) }, String(val));
    num.style.left = `${50 + 38 * Math.cos(angle)}%`;
    num.style.top = `${50 + 38 * Math.sin(angle)}%`;
    if (Number(val) === selected || String(val).padStart(2, '0') === String(selected).padStart(2, '0')) {
      num.classList.add('sel');
    }
    container.append(num);
  });
}

function angleFromEvent(face: HTMLElement, e: MouseEvent | TouchEvent): number {
  const rect = face.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const pt = 'touches' in e ? e.touches[0] : e;
  const x = pt.clientX - cx;
  const y = pt.clientY - cy;
  let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  return deg;
}

function updateFromAngle(deg: number): void {
  if (step === 'hour') {
    let hour = Math.round(deg / 30) % 12;
    if (hour === 0) hour = 12;
    state.hour12 = hour;
  } else {
    state.minute = snapMinute(Math.round(deg / 30) * 5);
  }
  renderFace();
}

function renderFace(): void {
  if (!cpFace || !cpHand || !cpDispH || !cpDispM || !cpHint) return;

  cpDispH.textContent = String(state.hour12);
  cpDispM.textContent = String(state.minute).padStart(2, '0');
  cpDispH.className = step === 'hour' ? 'active' : 'dim';
  cpDispM.className = step === 'minute' ? 'active' : 'dim';

  if (step === 'hour') {
    cpHint.textContent = 'Select hour';
    placeNums(cpFace, HOUR_LABELS, state.hour12);
    cpHand.style.transform = `rotate(${handDeg(state.hour12 % 12, 12)}deg)`;
  } else {
    cpHint.textContent = 'Select minute';
    placeNums(cpFace, MINUTE_LABELS, state.minute);
    cpHand.style.transform = `rotate(${handDeg(state.minute, 60)}deg)`;
  }
}

function showAmPm(): void {
  if (!apTime || !ampmOverlay || !clockOverlay) return;
  apTime.textContent = `${state.hour12}:${String(state.minute).padStart(2, '0')}`;
  ampmOverlay.hidden = false;
  clockOverlay.hidden = true;
}

function commitAmPm(period: Period): void {
  state.period = period;
  if (activePicker) {
    activePicker.hiddenInput.value = toTime24(state);
    activePicker.trigger.textContent = formatDisplay(state);
    activePicker.onCommit();
  }
  closeModal();
}

function closeModal(): void {
  dragging = false;
  activePicker = null;
  if (clockOverlay) clockOverlay.hidden = true;
  if (ampmOverlay) ampmOverlay.hidden = true;
  document.body.classList.remove('clock-picker-open');
}

function openModal(picker: ActivePicker): void {
  ensureModal();
  activePicker = picker;
  step = 'hour';
  state = parseTime24(picker.hiddenInput.value || '10:00');
  if (cpLabel) cpLabel.textContent = picker.modalLabel;
  if (clockOverlay) clockOverlay.hidden = false;
  if (ampmOverlay) ampmOverlay.hidden = true;
  document.body.classList.add('clock-picker-open');
  renderFace();
}

function ensureModal(): void {
  if (modalReady) return;

  cpDispH = el('span', { id: 'cp-disp-h', className: 'active' });
  const colon = el('span', { className: 'dim' }, ':');
  cpDispM = el('span', { id: 'cp-disp-m', className: 'dim' });
  cpLabel = el('span', { className: 'cp-label', id: 'cp-label' }, 'Time');
  cpHint = el('div', { className: 'cp-hint', id: 'cp-hint' }, 'Select hour');
  cpHand = el('div', { className: 'cp-hand', id: 'cp-hand' });
  const centerDot = el('div', { className: 'cp-center-dot' });
  cpFace = el('div', { className: 'cp-face', id: 'cp-face' }, cpHand, centerDot);
  apTime = el('div', { className: 'ap-time', id: 'ap-time' });

  const clockPanel = el('div', { className: 'clock-picker-panel' },
    el('div', { className: 'cp-header' },
      cpLabel,
      el('div', { className: 'cp-display' }, cpDispH, colon, cpDispM)
    ),
    el('div', { className: 'cp-face-wrap' }, cpFace),
    cpHint
  );

  clockOverlay = el('div', {
    className: 'clock-picker-overlay',
    id: 'clock-picker-overlay',
    hidden: 'true',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Select time',
  }, clockPanel);

  const amBtn = el('button', { type: 'button' }, 'AM');
  const pmBtn = el('button', { type: 'button' }, 'PM');
  amBtn.addEventListener('click', () => commitAmPm('AM'));
  pmBtn.addEventListener('click', () => commitAmPm('PM'));

  ampmOverlay = el('div', {
    className: 'ampm-picker-overlay',
    id: 'ampm-picker-overlay',
    hidden: 'true',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Select AM or PM',
  },
    el('div', { className: 'ampm-picker' },
      apTime,
      el('div', { className: 'ap-label' }, 'AM or PM?'),
      el('div', { className: 'ap-btns' }, amBtn, pmBtn)
    )
  );

  modalRoot = el('div', { id: 'clock-picker-modals' }, clockOverlay, ampmOverlay);
  document.body.append(modalRoot);

  clockOverlay.addEventListener('click', (e) => {
    if (e.target === clockOverlay) closeModal();
  });
  ampmOverlay.addEventListener('click', (e) => {
    if (e.target === ampmOverlay) closeModal();
  });
  clockPanel.addEventListener('click', (e) => e.stopPropagation());
  ampmOverlay.querySelector('.ampm-picker')?.addEventListener('click', (e) => e.stopPropagation());

  cpDispH.addEventListener('click', () => { step = 'hour'; renderFace(); });
  cpDispM.addEventListener('click', () => { step = 'minute'; renderFace(); });

  function onDown(e: MouseEvent | TouchEvent): void {
    e.preventDefault();
    dragging = true;
    updateFromAngle(angleFromEvent(cpFace!, e));
  }

  function onMove(e: MouseEvent | TouchEvent): void {
    if (!dragging) return;
    e.preventDefault();
    updateFromAngle(angleFromEvent(cpFace!, e));
  }

  function onUp(): void {
    if (!dragging) return;
    dragging = false;
    if (step === 'hour') {
      step = 'minute';
      renderFace();
    } else {
      showAmPm();
    }
  }

  cpFace.addEventListener('mousedown', onDown);
  cpFace.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  cpFace.addEventListener('touchstart', onDown, { passive: false });
  cpFace.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);

  modalReady = true;
}

export function createClockPicker(options: ClockPickerOptions): ClockPicker {
  const { id, required = false, large = false, label = 'Time', placeholder = 'Select time' } = options;
  const initialValue = options.value ?? '';

  const hiddenInput = el('input', {
    type: 'hidden',
    id,
    value: initialValue,
    required: required ? 'true' : undefined,
  }) as HTMLInputElement;

  const trigger = el('button', {
    type: 'button',
    className: `clock-picker-trigger${large ? ' clock-picker-trigger-lg' : ''}`,
  }) as HTMLButtonElement;

  const clearBtn = el('button', {
    type: 'button',
    className: 'clock-picker-clear',
    'aria-label': `Clear ${label.toLowerCase()}`,
    hidden: 'true',
  }, 'Clear') as HTMLButtonElement;

  const container = el('div', { className: 'clock-picker-field' }, hiddenInput, trigger, clearBtn);

  setTriggerState(trigger, initialValue, placeholder, clearBtn);

  const open = () => {
    openModal({
      hiddenInput,
      trigger,
      modalLabel: label,
      onCommit: () => {
        setTriggerState(trigger, hiddenInput.value, placeholder, clearBtn);
      },
    });
  };

  const clear = () => {
    hiddenInput.value = '';
    setTriggerState(trigger, '', placeholder, clearBtn);
  };

  trigger.addEventListener('click', open);
  clearBtn.addEventListener('click', clear);

  return {
    element: container,
    getValue: () => hiddenInput.value,
    setValue: (value: string) => {
      if (!value) {
        clear();
        return;
      }
      const parsed = parseTime24(value);
      hiddenInput.value = toTime24(parsed);
      setTriggerState(trigger, hiddenInput.value, placeholder, clearBtn);
    },
  };
}

export function createClockPickerField(
  label: string,
  options: ClockPickerOptions
): { group: HTMLElement; picker: ClockPicker } {
  const picker = createClockPicker({ ...options, label });
  const group = el('div', { className: 'form-group' },
    el('label', { for: options.id }, label),
    picker.element
  );
  return { group, picker };
}
