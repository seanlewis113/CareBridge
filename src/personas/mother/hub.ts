import { api } from '../../shared/api';
import { clearActivePersona, isAuthenticated } from '../../shared/auth';
import { navigate, MODULE_SELECT_PATH } from '../../shared/router';
import {
  getCalendarViewMode,
  groupEventsByDay,
  renderCalendarGridView,
  renderCalendarListView,
  renderCalendarViewToggle,
  type CalendarViewMode,
} from '../../shared/calendarViews';
import { el, greeting, formatDate, formatTime, formatCurrency, showModal, timeOfDayClass, showToast } from '../../shared/utils';
import { icon, type IconName } from '../../shared/icons';
import { renderAddEventForm } from './add-event';
import { ensureMotherHubRealtime, teardownMotherHubRealtime } from '../../shared/realtime';
import { getAreaAssigneeIds } from '../../shared/responsibilityAssignments';
import type { CalendarEvent } from '../../shared/types';

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleCleanup: (() => void) | null = null;
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

  const [settings, events, reminders, accounts, helpTasks, responsibilityAreas, profiles, responsibilityAssignments] =
    await Promise.all([
      api.getSettings(),
      api.getCalendarEvents(nowIso),
      api.getReminders(),
      api.getFinancialAccounts(),
      api.getMotherHubTasks(),
      api.getResponsibilityAreas(),
      api.getProfiles(),
      api.getResponsibilityAssignments(),
    ]);

  const chimeAccount = accounts.find(
    (a: import('../../shared/types').FinancialAccount) => a.institution.toLowerCase() === 'chime' && a.display_on_mother_hub
  );

  const activeReminders = reminders.filter((r: import('../../shared/types').Reminder) => r.active && r.show_on_mother_hub);
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
              ? chimeAccount.plaid_item_id
                ? `Updated ${formatDate(chimeAccount.last_synced)}`
                : `Updated ${formatDate(chimeAccount.last_synced)} · manual`
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
  const eventsTile = el('section', { className: 'mother-tile mother-tile--events mother-q-ml', 'aria-label': 'Upcoming events' },
    createTileHeader('calendar', 'Upcoming Events'),
    eventsBody
  );

  const displayEvents = selectNextOccurrencesForCard(events, 5);
  if (displayEvents.length === 0) {
    eventsBody.append(el('p', { className: 'mother-empty-hint' }, 'No events coming up.'));
  } else {
    const list = el('div', { className: 'mother-events-list card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--events' },
          el('span', {}, 'Date'),
          el('span', {}, 'Time'),
          el('span', {}, 'Event')
        )
      ),
      el('div', { className: 'card-table-body' })
    );
    const body = list.querySelector('.card-table-body')!;
    const grouped = groupEventsByDay(displayEvents);
    for (const [day, dayEvents] of grouped) {
      const dayLabel = day === todayStr ? 'Today' : formatDate(day + 'T12:00:00');
      for (const event of dayEvents) {
        body.append(
          el('div', { className: 'card-table-row card-table-row--events' },
            el('span', { className: 'mother-event-day-col' }, dayLabel),
            el('span', { className: 'mother-time-pill' }, formatTime(event.start_at)),
            el('span', { className: 'mother-event-title' }, event.title)
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

  const responsibleBody = el('div', { className: 'mother-tile-body' });
  const responsibleTile = el('section', {
    className: 'mother-tile mother-tile--responsible mother-q-responsible',
    'aria-label': "Who's responsible",
  },
    createTileHeader('briefcase', "Who's Responsible"),
    responsibleBody
  );

  const displayAreas = [...responsibilityAreas]
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 4);
  if (displayAreas.length === 0) {
    responsibleBody.append(el('p', { className: 'mother-empty-hint' }, 'No care areas assigned yet.'));
  } else {
    const list = el('div', { className: 'mother-responsible-list card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--responsible' },
          el('span', {}, ''),
          el('span', {}, 'Area'),
          el('span', {}, 'Who')
        )
      ),
      el('div', { className: 'card-table-body' })
    );
    const body = list.querySelector('.card-table-body')!;
    for (const area of displayAreas) {
      const assigneeIds = getAreaAssigneeIds(area.id, responsibilityAssignments);
      const assigneeNames = profiles
        .filter((p) => assigneeIds.includes(p.id))
        .map((p) => p.display_name);
      const who = assigneeNames.length > 0 ? assigneeNames.join(', ') : 'Not assigned';
      const isUnassigned = assigneeNames.length === 0;
      const avatarLabel = isUnassigned ? '?' : getInitials(assigneeNames[0]);
      body.append(
        el('div', { className: 'mother-responsible-item card-table-row card-table-row--responsible' },
          el('div', { className: `mother-avatar mother-avatar--responsible${isUnassigned ? ' mother-avatar--open' : ''}` },
            avatarLabel
          ),
          el('span', { className: 'mother-responsible-area' }, area.title),
          el('span', { className: `mother-responsible-who${isUnassigned ? ' mother-responsible-who--open' : ''}` }, who)
        )
      );
    }
    responsibleBody.append(list);
  }

  const helpBody = el('div', { className: 'mother-tile-body' });
  const helpTile = el('section', { className: 'mother-tile mother-tile--help mother-q-mr', 'aria-label': 'Who helps with what' },
    createTileHeader('users', 'Who helps you with what'),
    helpBody
  );

  const displayTasks = helpTasks.slice(0, 4);
  if (displayTasks.length === 0) {
    helpBody.append(el('p', { className: 'mother-empty-hint' }, 'No help scheduled yet.'));
  } else {
    const list = el('div', { className: 'mother-help-list card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--help' },
          el('span', {}, ''),
          el('span', {}, 'Who'),
          el('span', {}, 'Task'),
          el('span', {}, 'When')
        )
      ),
      el('div', { className: 'card-table-body' })
    );
    const body = list.querySelector('.card-table-body')!;
    for (const task of displayTasks) {
      const helper = task.helper_name ?? (task.open_slot ? 'Looking for help' : '—');
      const isOpen = helper === 'Looking for help';
      body.append(
        el('div', { className: 'mother-help-item card-table-row card-table-row--help' },
          el('div', { className: `mother-avatar${isOpen ? ' mother-avatar--open' : ''}` },
            isOpen ? '?' : getInitials(helper)
          ),
          el('span', { className: `mother-help-who${isOpen ? ' mother-help-who--open' : ''}` }, helper),
          el('span', { className: 'mother-help-what' }, task.title),
          task.due_at
            ? el('span', { className: 'mother-help-when' }, formatDate(task.due_at))
            : el('span', { className: 'mother-help-when card-table-muted' }, '—')
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

  content.append(balanceTile, responsibleTile, eventsTile, helpTile, remindersTile);

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

  setupIdleTimer();
  ensureMotherHubRealtime(() => {
    void renderMotherHub();
  });
}

export function teardownMotherHub(): void {
  teardownMotherHubRealtime();
  idleCleanup?.();
  idleCleanup = null;
}

function setupIdleTimer(): void {
  idleCleanup?.();
  resetIdleTimer();
  const onActivity = () => resetIdleTimer();
  document.addEventListener('mousemove', onActivity);
  document.addEventListener('touchstart', onActivity);
  idleCleanup = () => {
    document.removeEventListener('mousemove', onActivity);
    document.removeEventListener('touchstart', onActivity);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
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

function showAllEventsCalendarModal(events: CalendarEvent[]): void {
  let viewMode: CalendarViewMode = getCalendarViewMode();
  const body = el('div', { className: 'mother-calendar-modal modal-body' });
  const header = el('div', { className: 'mother-calendar-modal-header' });
  const subtitle = el(
    'p',
    { className: 'app-calendar-subtitle' },
    `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'}`
  );
  const headerActions = el('div', { className: 'mother-calendar-modal-header-actions' });
  const viewHost = el('div', {});
  const contentHost = el('div', {});

  const renderView = () => {
    viewHost.replaceChildren(renderCalendarViewToggle(viewMode, (mode) => {
      viewMode = mode;
      renderView();
    }));
    contentHost.replaceChildren();
    if (events.length === 0) {
      contentHost.append(el('p', { className: 'mother-empty-hint' }, 'No events coming up.'));
      return;
    }
    contentHost.append(
      viewMode === 'grid'
        ? renderCalendarGridView(events, { showToolbar: false })
        : renderCalendarListView(events)
    );
  };

  header.append(subtitle, headerActions);
  headerActions.append(viewHost);
  body.append(header, contentHost);
  renderView();

  showModal('All Upcoming Events', body);
  body.closest('.modal')?.classList.add('mother-calendar-modal-shell');
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

function showSwitchUserDialog(): void {
  clearActivePersona();
  void navigate(isAuthenticated() ? MODULE_SELECT_PATH : '/');
}
