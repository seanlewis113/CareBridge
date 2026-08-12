import { api } from '../../shared/api';
import { clearActivePersona } from '../../shared/auth';
import { navigate } from '../../shared/router';
import { el, greeting, formatDate, formatTime, formatCurrency, showModal, timeOfDayClass, showToast } from '../../shared/utils';
import { icon, type IconName } from '../../shared/icons';
import { renderAddEventForm } from './add-event';
import { promptAdminSwitchPin } from '../../shared/pin';
import type { CalendarEvent } from '../../shared/types';

let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const CARD_IMAGE_STORAGE_KEY = 'moms-care-mother-card-images';
const CARD_PREVIEW_WIDTH = 600;
const CARD_PREVIEW_HEIGHT = 325;

type CardSide = 'front' | 'back';

interface CardImageConfig {
  original: string;
  cropped: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

type CardImageStore = Partial<Record<CardSide, CardImageConfig>>;

export async function renderMotherHub(): Promise<void> {
  const app = document.getElementById('app')!;
  app.className = 'mother-app';
  const nowIso = new Date().toISOString();

  const layout = el('div', { className: 'mother-layout page-enter' });
  const skeleton = el('div', { className: 'mother-skeleton' },
    el('div', { className: 'skeleton skeleton-text-lg', style: 'margin:2rem auto' }),
    el('div', { className: 'skeleton skeleton-card' }),
    el('div', { className: 'skeleton skeleton-card' }),
    el('div', { className: 'skeleton skeleton-card' })
  );
  layout.append(skeleton);
  app.replaceChildren(layout);

  const [settings, events, reminders, accounts, tasks, profiles, assignments] = await Promise.all([
    api.getSettings(),
    api.getCalendarEvents(nowIso),
    api.getReminders(),
    api.getFinancialAccounts(),
    api.getTasks(),
    api.getProfiles(),
    api.getTaskAssignments(),
  ]);

  const chimeAccount = accounts.find(
    (a: import('../../shared/types').FinancialAccount) => a.institution.toLowerCase() === 'chime' && a.display_on_mother_hub
  );

  const activeReminders = reminders.filter((r: import('../../shared/types').Reminder) => r.active && r.show_on_mother_hub);
  const activeTasks = tasks
    .filter((t: import('../../shared/types').Task) => t.status !== 'completed' && t.show_on_mother_hub !== false)
    .sort((a, b) => {
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const todClass = timeOfDayClass();

  layout.replaceChildren();

  const header = el('div', { className: `mother-hero ${todClass}` },
    el('button', {
      className: 'mother-header-btn',
      type: 'button',
      id: 'refresh-hub',
      'aria-label': 'Refresh',
    }, icon('refresh')),
    el('div', { className: 'mother-hero-text' },
      el('h1', {}, `${greeting()}, ${settings.mother_name}`),
      el('span', { className: 'hero-sep' }, '·'),
      el('p', { className: 'date-display' },
        today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      )
    ),
    el('div', { className: 'mother-header-actions' },
      el('button', {
        className: 'mother-header-btn mother-header-btn--primary',
        type: 'button',
        id: 'add-event-btn',
        'aria-label': 'Add to calendar',
      }, icon('plus')),
      el('button', {
        className: 'mother-header-btn',
        type: 'button',
        id: 'switch-user-btn',
        'aria-label': 'Family login',
      }, icon('log-out'))
    )
  );

  const content = el('div', { className: 'mother-content' });

  const balanceTile = el('section', { className: 'mother-tile mother-tile--balance mother-q-tl', 'aria-label': 'Chime balance' },
    createTileHeader('wallet', 'Chime Balance'),
    el('div', { className: 'mother-tile-body' },
      el('div', { className: 'mother-balance-layout' },
        el('div', { className: 'mother-balance-main' },
          el('p', { className: 'mother-balance' },
            chimeAccount?.last_balance != null ? formatCurrency(chimeAccount.last_balance) : '—'
          ),
          el('p', { className: 'mother-balance-meta' },
            chimeAccount?.last_synced
              ? `Updated ${formatDate(chimeAccount.last_synced)}`
              : 'Not synced'
          )
        ),
        el('div', { className: 'mother-card-images' },
          createCardSlot('front', 'Front of card'),
          createCardSlot('back', 'Back of card')
        )
      )
    )
  );

  const eventsBody = el('div', { className: 'mother-tile-body' });
  const eventsTile = el('section', { className: 'mother-tile mother-tile--events mother-q-bl', 'aria-label': 'Upcoming events' },
    createTileHeader('calendar', 'Upcoming Events'),
    eventsBody
  );

  const displayEvents = selectNextOccurrencesForCard(events, 5);
  if (displayEvents.length === 0) {
    eventsBody.append(el('p', { className: 'mother-empty-hint' }, 'No events coming up.'));
  } else {
    const list = el('div', { className: 'mother-events-list' });
    const grouped = groupEventsByDay(displayEvents);
    for (const [day, dayEvents] of grouped) {
      const dayLabel = day === todayStr ? 'Today' : formatDate(day + 'T12:00:00');
      list.append(el('span', { className: 'mother-event-day' }, dayLabel));
      for (const event of dayEvents) {
        list.append(
          el('div', { className: 'mother-event-item' },
            el('span', { className: 'mother-time-pill' }, formatTime(event.start_at)),
            el('div', { className: 'mother-event-title' }, event.title)
          )
        );
      }
    }
    eventsBody.append(list);
  }
  eventsTile.classList.add('mother-events-clickable');
  eventsTile.setAttribute('role', 'button');
  eventsTile.setAttribute('tabindex', '0');
  eventsTile.setAttribute('aria-label', 'Open full calendar view');
  const openCalendarModal = () => showAllEventsCalendarModal(events);
  eventsTile.addEventListener('click', openCalendarModal);
  eventsTile.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCalendarModal();
    }
  });

  const helpBody = el('div', { className: 'mother-tile-body' });
  const helpTile = el('section', { className: 'mother-tile mother-tile--help mother-q-tr', 'aria-label': 'Who helps with what' },
    createTileHeader('users', 'Who helps you with what'),
    helpBody
  );

  const displayTasks = activeTasks.slice(0, 4);
  if (displayTasks.length === 0) {
    helpBody.append(el('p', { className: 'mother-empty-hint' }, 'No help scheduled yet.'));
  } else {
    const list = el('div', { className: 'mother-help-list' });
    for (const task of displayTasks) {
      const helper = getTaskHelperLabel(task, profiles, assignments);
      const isOpen = helper === 'Looking for help';
      list.append(
        el('div', { className: 'mother-help-item' },
          el('div', { className: 'mother-help-row' },
            el('div', { className: `mother-avatar${isOpen ? ' mother-avatar--open' : ''}` },
              isOpen ? '?' : getInitials(helper)
            ),
            el('div', { className: 'mother-help-content' },
              el('div', { className: `mother-help-who${isOpen ? ' mother-help-who--open' : ''}` }, helper),
              el('div', { className: 'mother-help-what' }, task.title),
              task.due_at
                ? el('div', { className: 'mother-help-when' }, formatDate(task.due_at))
                : null
            )
          )
        )
      );
    }
    helpBody.append(list);
  }

  const remindersBody = el('div', { className: 'mother-tile-body' });
  const remindersTile = el('section', { className: 'mother-tile mother-tile--remember mother-q-br', 'aria-label': 'Things to remember' },
    createTileHeader('bell', 'Things to Remember'),
    remindersBody
  );

  const displayReminders = activeReminders.slice(0, 4);
  if (displayReminders.length === 0) {
    remindersBody.append(el('p', { className: 'mother-empty-hint' }, 'Nothing to remember right now.'));
  } else {
    const list = el('div', { className: 'mother-reminder-list' });
    for (const reminder of displayReminders) {
      list.append(
        el('div', { className: 'mother-reminder-item' },
          el('div', { className: 'mother-reminder-icon' }, icon('bell')),
          el('span', { className: 'mother-reminder-text' }, reminder.body)
        )
      );
    }
    remindersBody.append(list);
  }

  content.append(balanceTile, eventsTile, helpTile, remindersTile);

  layout.append(header, content);
  app.replaceChildren(layout);

  document.getElementById('add-event-btn')?.addEventListener('click', () => {
    const form = renderAddEventForm(async () => {
      close();
      showToast('Event added to calendar', 'success');
      await renderMotherHub();
    });
    const close = showModal('Add to Calendar', form);
  });

  document.getElementById('refresh-hub')?.addEventListener('click', () => renderMotherHub());

  document.getElementById('switch-user-btn')?.addEventListener('click', () => showSwitchUserDialog());

  resetIdleTimer();
  document.addEventListener('mousemove', resetIdleTimer);
  document.addEventListener('touchstart', resetIdleTimer);
}

function createTileHeader(iconName: IconName, title: string): HTMLElement {
  return el('div', { className: 'mother-tile-header' },
    el('div', { className: 'mother-tile-icon' }, icon(iconName)),
    el('h2', { className: 'mother-tile-title' }, title)
  );
}

function createCardSlot(side: CardSide, label: string): HTMLElement {
  const wrapper = el('div', { className: 'mother-card-slot-wrap' });
  const slotButton = el('button', {
    type: 'button',
    className: 'mother-card-slot',
    'aria-label': `Upload ${label.toLowerCase()} image`,
    title: `Upload ${label.toLowerCase()}`,
  }) as HTMLButtonElement;
  const input = el('input', {
    type: 'file',
    accept: 'image/*',
    className: 'mother-card-file-input',
  }) as HTMLInputElement;

  const saved = readCardImageStore()[side];
  renderCardSlotContent(slotButton, saved, label);

  slotButton.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const originalDataUrl = await fileToDataUrl(file);
      const cropResult = await showCardCropDialog(originalDataUrl, label);
      if (!cropResult) return;

      const store = readCardImageStore();
      store[side] = cropResult;
      writeCardImageStore(store);
      renderCardSlotContent(slotButton, cropResult, label);
      showToast(`${label} image updated`, 'success');
    } catch {
      showToast('Unable to upload image', 'error');
    } finally {
      input.value = '';
    }
  });

  wrapper.append(slotButton, input);
  return wrapper;
}

function renderCardSlotContent(container: HTMLElement, config: CardImageConfig | undefined, label: string): void {
  container.replaceChildren();
  if (!config) {
    container.append(el('span', { className: 'mother-card-slot-label' }, label));
    return;
  }
  container.append(el('img', { src: config.cropped, alt: label }));
}

function readCardImageStore(): CardImageStore {
  try {
    const raw = localStorage.getItem(CARD_IMAGE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CardImageStore;
  } catch {
    return {};
  }
}

function writeCardImageStore(store: CardImageStore): void {
  localStorage.setItem(CARD_IMAGE_STORAGE_KEY, JSON.stringify(store));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderCroppedCardImage(
  originalSrc: string,
  zoom: number,
  offsetX: number,
  offsetY: number
): Promise<string> {
  const image = await loadImage(originalSrc);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_PREVIEW_WIDTH;
  canvas.height = CARD_PREVIEW_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  const layout = calculateCropLayout(CARD_PREVIEW_WIDTH, CARD_PREVIEW_HEIGHT, image.width, image.height, zoom, offsetX, offsetY);

  ctx.drawImage(image, layout.drawX, layout.drawY, layout.drawWidth, layout.drawHeight);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function calculateCropLayout(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  offsetX: number,
  offsetY: number
): { drawX: number; drawY: number; drawWidth: number; drawHeight: number; maxPanX: number; maxPanY: number } {
  const baseScale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const scale = baseScale * zoom;
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const maxPanX = Math.max(0, (drawWidth - viewportWidth) / 2);
  const maxPanY = Math.max(0, (drawHeight - viewportHeight) / 2);
  const clampedOffsetX = Math.max(-1, Math.min(1, offsetX));
  const clampedOffsetY = Math.max(-1, Math.min(1, offsetY));
  const drawX = (viewportWidth - drawWidth) / 2 + clampedOffsetX * maxPanX;
  const drawY = (viewportHeight - drawHeight) / 2 + clampedOffsetY * maxPanY;
  return { drawX, drawY, drawWidth, drawHeight, maxPanX, maxPanY };
}

async function showCardCropDialog(originalSrc: string, label: string): Promise<CardImageConfig | null> {
  const form = el('form', { className: 'mother-card-crop-form modal-body' });
  const previewViewport = el('div', { className: 'mother-card-crop-preview' }) as HTMLDivElement;
  const previewImage = el('img', { src: originalSrc, alt: `${label} preview` }) as HTMLImageElement;
  const dimOverlay = el('div', { className: 'mother-card-crop-overlay' });
  const cropWindow = el('div', { className: 'mother-card-crop-window' });
  previewViewport.append(previewImage, dimOverlay, cropWindow);

  const helpText = el(
    'p',
    { className: 'mother-card-crop-help' },
    'Drag the image to position it. Use mouse wheel or touchpad pinch to zoom.'
  );
  const zoomText = el('p', { className: 'mother-card-crop-zoom' }, 'Zoom: 100%');

  const resetBtn = el('button', { type: 'button', className: 'btn btn-secondary', id: 'reset-card-crop' }, 'Reset');

  const image = await loadImage(originalSrc);
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance = 0;
  let pinchStartZoom = zoom;

  function getCropMetrics(): { viewportRect: DOMRect; windowRect: DOMRect } {
    return {
      viewportRect: previewViewport.getBoundingClientRect(),
      windowRect: cropWindow.getBoundingClientRect(),
    };
  }

  function applyPanDelta(deltaX: number, deltaY: number): void {
    const { windowRect } = getCropMetrics();
    if (windowRect.width === 0 || windowRect.height === 0) return;
    const layout = calculateCropLayout(windowRect.width, windowRect.height, image.width, image.height, zoom, offsetX, offsetY);
    if (layout.maxPanX > 0) offsetX += deltaX / layout.maxPanX;
    if (layout.maxPanY > 0) offsetY += deltaY / layout.maxPanY;
    offsetX = Math.max(-1, Math.min(1, offsetX));
    offsetY = Math.max(-1, Math.min(1, offsetY));
    refreshPreview();
  }

  function refreshPreview(): void {
    const { viewportRect, windowRect } = getCropMetrics();
    if (windowRect.width === 0 || windowRect.height === 0) return;
    const layout = calculateCropLayout(windowRect.width, windowRect.height, image.width, image.height, zoom, offsetX, offsetY);
    const viewportOffsetX = windowRect.left - viewportRect.left;
    const viewportOffsetY = windowRect.top - viewportRect.top;
    previewImage.style.width = `${layout.drawWidth}px`;
    previewImage.style.height = `${layout.drawHeight}px`;
    previewImage.style.left = `${viewportOffsetX + layout.drawX}px`;
    previewImage.style.top = `${viewportOffsetY + layout.drawY}px`;
    zoomText.textContent = `Zoom: ${Math.round(zoom * 100)}%`;
  }

  previewViewport.addEventListener('pointerdown', (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 1) {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      previewViewport.setPointerCapture(event.pointerId);
    } else if (activePointers.size === 2) {
      const points = [...activePointers.values()];
      pinchStartDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      pinchStartZoom = zoom;
    }
  });

  previewViewport.addEventListener('pointermove', (event) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) {
      const points = [...activePointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (pinchStartDistance > 0) {
        zoom = Math.max(1, Math.min(3, pinchStartZoom * (distance / pinchStartDistance)));
        refreshPreview();
      }
      return;
    }
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    applyPanDelta(dx, dy);
  });

  function endPointer(pointerId: number): void {
    activePointers.delete(pointerId);
    if (activePointers.size === 0) {
      dragging = false;
    }
    if (activePointers.size < 2) {
      pinchStartDistance = 0;
      pinchStartZoom = zoom;
    }
  }

  previewViewport.addEventListener('pointerup', (event) => endPointer(event.pointerId));
  previewViewport.addEventListener('pointercancel', (event) => endPointer(event.pointerId));
  previewViewport.addEventListener('pointerleave', (event) => endPointer(event.pointerId));

  previewViewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const nextZoom = zoom * Math.exp(-event.deltaY * 0.0015);
      zoom = Math.max(1, Math.min(3, nextZoom));
      refreshPreview();
    },
    { passive: false }
  );

  window.addEventListener('resize', refreshPreview);

  form.append(
    previewViewport,
    helpText,
    zoomText,
    el('div', { className: 'mother-card-crop-actions' },
      resetBtn
    ),
    el('div', { className: 'modal-actions' },
      el('button', { type: 'submit', className: 'btn btn-primary' }, 'Save'),
      el('button', { type: 'button', className: 'btn btn-secondary', id: 'cancel-card-crop' }, 'Cancel')
    )
  );

  return new Promise((resolve) => {
    const close = showModal(`Crop ${label}`, form);
    requestAnimationFrame(refreshPreview);

    form.querySelector('#cancel-card-crop')?.addEventListener('click', () => {
      window.removeEventListener('resize', refreshPreview);
      close();
      resolve(null);
    });
    form.querySelector('#reset-card-crop')?.addEventListener('click', () => {
      zoom = 1;
      offsetX = 0;
      offsetY = 0;
      refreshPreview();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const cropped = await renderCroppedCardImage(originalSrc, zoom, offsetX, offsetY);
        window.removeEventListener('resize', refreshPreview);
        close();
        resolve({ original: originalSrc, cropped, zoom, offsetX, offsetY });
      } catch {
        showToast('Unable to crop image', 'error');
        resolve(null);
      }
    });
  });
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => renderMotherHub(), IDLE_TIMEOUT_MS);
}

function groupEventsByDay(events: { start_at: string; title: string }[]): [string, typeof events][] {
  const map = new Map<string, typeof events>();
  for (const event of events) {
    const day = event.start_at.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(event);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function showAllEventsCalendarModal(events: CalendarEvent[]): void {
  const now = new Date();
  const body = el('div', { className: 'mother-calendar-modal modal-body' });
  const subtitle = el(
    'p',
    { className: 'mother-calendar-modal-subtitle' },
    `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'}`
  );
  body.append(subtitle);

  if (events.length === 0) {
    body.append(el('p', { className: 'mother-empty-hint' }, 'No events coming up.'));
  } else {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const day = event.start_at.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(event);
    }

    const monthsWrap = el('div', { className: 'mother-calendar-months' });
    const monthStarts = buildMonthStarts(now, events);
    for (const monthStart of monthStarts) {
      monthsWrap.append(renderCalendarMonth(monthStart, byDay, now));
    }
    body.append(monthsWrap);
  }

  showModal('All Upcoming Events', body);
  body.closest('.modal')?.classList.add('mother-calendar-modal-shell');
  requestAnimationFrame(() => {
    const currentWeekCell = body.querySelector('.mother-calendar-day--current-week');
    currentWeekCell?.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
}

function buildMonthStarts(now: Date, events: CalendarEvent[]): Date[] {
  const starts: Date[] = [];
  const monthStartNow = new Date(now.getFullYear(), now.getMonth(), 1);
  const eventMonths = events.map((event) => {
    const date = new Date(event.start_at);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const earliest = [monthStartNow, ...eventMonths].reduce((min, current) => (current < min ? current : min));
  const latest = [monthStartNow, ...eventMonths].reduce((max, current) => (current > max ? current : max));

  let cursor = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  while (cursor <= latest) {
    starts.push(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return starts;
}

function renderCalendarMonth(monthStart: Date, eventsByDay: Map<string, CalendarEvent[]>, now: Date): HTMLElement {
  const monthCard = el('section', { className: 'mother-calendar-month' });
  const monthTitle = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  monthCard.append(el('h3', { className: 'mother-calendar-month-title' }, monthTitle));

  const weekdays = el('div', { className: 'mother-calendar-weekdays' });
  for (const label of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    weekdays.append(el('span', { className: 'mother-calendar-weekday' }, label));
  }
  monthCard.append(weekdays);

  const grid = el('div', { className: 'mother-calendar-grid' });
  const firstWeekday = monthStart.getDay();
  for (let i = 0; i < firstWeekday; i++) {
    grid.append(el('div', { className: 'mother-calendar-day mother-calendar-day--blank', 'aria-hidden': 'true' }));
  }

  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
    const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), dayNumber);
    const key = dayDate.toISOString().slice(0, 10);
    const dayEvents = eventsByDay.get(key) ?? [];
    const isToday = key === now.toISOString().slice(0, 10);
    const isPast = dayDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isInCurrentWeek = isDateInCurrentWeek(dayDate, now);

    const dayCell = el('div', {
      className: `mother-calendar-day${isToday ? ' mother-calendar-day--today' : ''}${isPast ? ' mother-calendar-day--past' : ''}${isInCurrentWeek ? ' mother-calendar-day--current-week' : ''}`,
    });
    dayCell.append(el('div', { className: 'mother-calendar-day-number' }, String(dayNumber)));

    if (dayEvents.length > 0) {
      const eventsList = el('div', { className: 'mother-calendar-day-events' });
      for (const event of dayEvents) {
        eventsList.append(
          el('div', { className: 'mother-calendar-day-event' },
            el('span', { className: 'mother-calendar-day-event-time' }, formatTime(event.start_at)),
            el('span', { className: 'mother-calendar-day-event-title' }, event.title)
          )
        );
      }
      dayCell.append(eventsList);
    }

    grid.append(dayCell);
  }

  monthCard.append(grid);
  return monthCard;
}

function selectNextOccurrencesForCard(events: CalendarEvent[], limit: number): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  const seenSeries = new Set<string>();
  for (const event of events) {
    const seriesId = event.recurrence_source_id ?? event.id;
    if (seenSeries.has(seriesId)) continue;
    seenSeries.add(seriesId);
    result.push(event);
    if (result.length >= limit) break;
  }
  return result;
}

function isDateInCurrentWeek(date: Date, today: Date): boolean {
  const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const endOfWeek = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 7);
  const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return candidate >= startOfWeek && candidate < endOfWeek;
}

function getTaskHelperLabel(
  task: import('../../shared/types').Task,
  profiles: import('../../shared/types').Profile[],
  assignments: import('../../shared/types').TaskAssignment[]
): string {
  if (task.claimed_by) {
    const claimer = profiles.find((p) => p.id === task.claimed_by);
    if (claimer) return claimer.display_name;
  }

  const assignedIds = assignments
    .filter((a) => a.task_id === task.id)
    .map((a) => a.profile_id);
  const names = profiles
    .filter((p) => assignedIds.includes(p.id))
    .map((p) => p.display_name);

  if (names.length === 1) return names[0];
  if (names.length > 1) return names.join(' & ');

  if (task.open_slot) return 'Looking for help';
  return 'Family';
}

function showSwitchUserDialog(): void {
  void (async () => {
    const ok = await promptAdminSwitchPin();
    if (!ok) return;
    clearActivePersona();
    await navigate('/');
  })();
}
