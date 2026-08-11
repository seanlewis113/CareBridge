import { api } from '../../shared/api';
import { renderCaregiverShell } from '../shared/shell';
import { el, formatDate } from '../../shared/utils';
import { FOLDER_LABELS } from '../../shared/types';

export async function renderCaregiverDocuments(): Promise<void> {
  const docs = await api.getDocuments();
  const content = el('div', {});

  content.append(
    el('h2', {}, 'Documents'),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
      'Reference documents shared by the family (read-only).'
    )
  );

  if (docs.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No documents available.'));
  } else {
    for (const doc of docs) {
      const card = el('div', { className: 'card list-item', style: 'margin-bottom:0.5rem' },
        el('div', {},
          el('strong', {}, doc.name),
          el('div', { style: 'font-size:0.85rem;color:var(--color-text-muted)' },
            `${FOLDER_LABELS[doc.folder]} · ${formatDate(doc.created_at)}`
          )
        ),
        el('button', { className: 'btn btn-secondary', type: 'button', style: 'min-height:auto;padding:0.35rem 0.75rem' }, 'View')
      );

      card.querySelector('button')?.addEventListener('click', async () => {
        const url = await api.getDocumentUrl(doc);
        window.open(url, '_blank');
      });

      content.append(card);
    }
  }

  renderCaregiverShell(content, '/caregiver/documents');
}
