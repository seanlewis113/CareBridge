import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderCaregiverShell } from '../shared/shell';
import { el, formatDate } from '../../shared/utils';

export async function renderCaregiverNotes(): Promise<void> {
  const session = getSession();
  const notes = await api.getVisitNotes();

  const content = el('div', {});
  content.append(el('h2', {}, 'Visit History'));

  if (notes.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No visit notes yet.'));
  } else {
    for (const note of notes) {
      const isOwn = note.author_id === session.profile?.id;
      content.append(renderNoteCard(note, isOwn));
    }
  }

  renderCaregiverShell(content, '/caregiver/notes');
}

function renderNoteCard(
  note: import('../../shared/types').VisitNote,
  isOwn: boolean
): HTMLElement {
  const card = el('div', { className: 'card visit-note-card' },
    el('p', { className: 'visit-note-meta' },
      `${formatDate(note.visit_date)} — ${note.author?.display_name ?? 'Caregiver'}`,
      isOwn ? el('span', { style: 'margin-left:0.5rem;color:var(--color-primary)' }, '(your note)') : null
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
