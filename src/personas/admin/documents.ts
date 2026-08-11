import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, formatDate, showModal, confirmDialog } from '../../shared/utils';
import { FOLDER_LABELS, type Document } from '../../shared/types';

export async function renderAdminDocuments(): Promise<void> {
  let activeFolder: Document['folder'] | 'all' = 'all';
  const content = el('div', {});

  const render = async () => {
    const docs = await api.getDocuments();
    const filtered = activeFolder === 'all' ? docs : docs.filter((d) => d.folder === activeFolder);

    content.replaceChildren(
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
        el('h2', {}, 'Documents'),
        el('button', { className: 'btn btn-primary', type: 'button', id: 'upload-doc' }, '+ Upload')
      ),
      renderFolderTabs(activeFolder, (folder) => { activeFolder = folder; render(); }),
      renderDocList(filtered, render)
    );

    document.getElementById('upload-doc')?.addEventListener('click', () => {
      const form = createUploadForm(async () => { close(); await render(); });
      const close = showModal('Upload Document', form);
    });
  };

  await render();
  renderAdminShell(content, '/admin/documents');
}

function renderFolderTabs(
  active: Document['folder'] | 'all',
  onSelect: (folder: Document['folder'] | 'all') => void
): HTMLElement {
  const tabs = el('div', { className: 'doc-folder-tabs' });
  const folders: (Document['folder'] | 'all')[] = ['all', 'medical', 'legal', 'daily_routine', 'emergency'];

  for (const folder of folders) {
    const btn = el('button', {
      type: 'button',
      className: active === folder ? 'active' : '',
    }, folder === 'all' ? 'All' : FOLDER_LABELS[folder]);
    btn.addEventListener('click', () => onSelect(folder));
    tabs.append(btn);
  }
  return tabs;
}

function renderDocList(docs: Document[], refresh: () => void): HTMLElement {
  const list = el('div', {});
  if (docs.length === 0) {
    list.append(el('p', { className: 'empty-state' }, 'No documents in this folder.'));
    return list;
  }

  for (const doc of docs) {
    const card = el('div', { className: 'card list-item', style: 'margin-bottom:0.5rem' },
      el('div', {},
        el('strong', {}, doc.name),
        el('div', { style: 'font-size:0.85rem;color:var(--color-text-muted)' },
          `${FOLDER_LABELS[doc.folder]} · ${formatDate(doc.created_at)}`
        )
      ),
      el('div', { style: 'display:flex;gap:0.5rem' },
        el('button', { className: 'btn btn-secondary', type: 'button', style: 'min-height:auto;padding:0.35rem 0.75rem' }, 'View'),
        el('button', { className: 'btn btn-danger', type: 'button', style: 'min-height:auto;padding:0.35rem 0.75rem' }, 'Delete')
      )
    );

    card.querySelector('.btn-secondary')?.addEventListener('click', async () => {
      const url = await api.getDocumentUrl(doc);
      window.open(url, '_blank');
    });

    card.querySelector('.btn-danger')?.addEventListener('click', async () => {
      if (await confirmDialog('Delete this document?')) {
        await api.deleteDocument(doc.id);
        await refresh();
      }
    });

    list.append(card);
  }
  return list;
}

function createUploadForm(onSuccess: () => void): HTMLElement {
  const session = getSession();
  const form = el('form', { className: 'modal-body' });

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'doc-file' }, 'File'),
      el('input', { type: 'file', id: 'doc-file', required: 'true', accept: '.pdf,.png,.jpg,.jpeg,.doc,.docx' })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'doc-folder' }, 'Folder'),
      el('select', { id: 'doc-folder' },
        ...(['medical', 'legal', 'daily_routine', 'emergency'] as const).map((f) =>
          el('option', { value: f }, FOLDER_LABELS[f])
        )
      )
    ),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, 'Upload')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = (form.querySelector('#doc-file') as HTMLInputElement).files?.[0];
    const folder = (form.querySelector('#doc-folder') as HTMLSelectElement).value as Document['folder'];
    if (!file) return;
    await api.uploadDocument(file, folder, session.profile?.id ?? null);
    onSuccess();
  });

  return form;
}
