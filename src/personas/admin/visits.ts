import { api } from '../../shared/api';
import { renderAdminShell } from '../shared/shell';
import { el, formatDate } from '../../shared/utils';

export async function renderAdminVisits(): Promise<void> {
  const notes = await api.getVisitNotes();
  const content = el('div', {});

  content.append(el('h2', {}, 'Visit Notes'));

  if (notes.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No visit notes yet. Caregivers can log visits from their dashboard.'));
  } else {
    for (const note of notes) {
      content.append(renderVisitNoteCard(note));
    }
  }

  renderAdminShell(content, '/admin/visits');
}

function renderVisitNoteCard(note: import('../../shared/types').VisitNote): HTMLElement {
  const card = el('div', { className: 'card visit-note-card' },
    el('p', { className: 'visit-note-meta' },
      `${formatDate(note.visit_date)} — ${note.author?.display_name ?? 'Caregiver'}`
    ),
    el('dl', { className: 'visit-note-fields' })
  );

  const dl = card.querySelector('dl')!;
  const fields: [string, string | null][] = [
    ['Mood', note.mood],
    ['Meals', note.meals],
    ['Medications', note.meds],
    ['Activities', note.activities],
    ['Concerns', note.concerns],
    ['Notes', note.notes],
  ];

  for (const [label, value] of fields) {
    if (value) {
      dl.append(
        el('div', { className: 'card-table-row card-table-row--visit' },
          el('dt', {}, label),
          el('dd', {}, value)
        )
      );
    }
  }

  return card;
}
