import { api, isResponsibilitySchemaReady } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, showModal, confirmDialog } from '../../shared/utils';
import { PERSONA_LABELS, type ResponsibilityArea, type Profile, type Persona } from '../../shared/types';
import { getAreaAssigneeIds } from '../../shared/responsibilityAssignments';

export async function renderAdminResponsibility(): Promise<void> {
  const content = el('div', {});

  const render = async () => {
    const [areas, profiles, assignments] = await Promise.all([
      api.getResponsibilityAreas(),
      api.getProfiles(),
      api.getResponsibilityAssignments(),
    ]);

    content.replaceChildren();

    if (!isResponsibilitySchemaReady()) {
      content.append(
        el('div', {
          className: 'card',
          style: 'margin-bottom:1rem;padding:1rem;background:#fff8e6;border:1px solid #f0d78c',
        },
          el('p', { style: 'margin:0;font-weight:600' }, 'Database setup required'),
          el('p', { style: 'margin:0.5rem 0 0;color:var(--color-text-muted)' },
            'Run the Who\'s Responsible migration in your Supabase SQL editor: '
          ),
          el('code', { style: 'display:block;margin-top:0.35rem;font-size:0.85rem' },
            'supabase/migrations/20260816130000_whos_responsible.sql'
          ),
          el('p', { style: 'margin:0.5rem 0 0;color:var(--color-text-muted);font-size:0.9rem' },
            'Or run the Who\'s Responsible section at the end of supabase/run-in-sql-editor.sql, then refresh this page.'
          )
        )
      );
    }

    const newAreaBtn = el('button', { className: 'btn btn-primary', type: 'button' }, '+ New Area');
    newAreaBtn.addEventListener('click', () => {
      const form = createAreaForm(profiles, async () => { close(); await render(); });
      const close = showModal('New Responsibility Area', form);
    });

    content.append(
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
        el('h2', {}, 'Who\'s Responsible'),
        newAreaBtn
      ),
      el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
        'Track who owns ongoing areas of care — finances, medical appointments, home maintenance, and more.'
      )
    );

    const list = el('div', {});
    if (areas.length === 0) {
      list.append(
        el('p', { className: 'empty-state' },
          'No responsibility areas yet. Add one to clarify who handles what.'
        )
      );
    } else {
      for (const area of areas) {
        const assigneeIds = getAreaAssigneeIds(area.id, assignments);
        list.append(renderAreaCard(area, profiles, assigneeIds, render));
      }
    }
    content.append(list);

  };

  await render();
  renderAdminShell(content, '/admin/responsibility');
}

function renderAreaCard(
  area: ResponsibilityArea,
  profiles: Profile[],
  assigneeIds: string[],
  refresh: () => void | Promise<void>
): HTMLElement {
  const assigneeNames = profiles
    .filter((p) => assigneeIds.includes(p.id))
    .map((p) => p.display_name);

  const responsible = el('p', { style: 'margin:0.35rem 0 0' },
    assigneeNames.length > 0
      ? el('span', {},
          el('strong', {}, 'Responsible: '),
          assigneeNames.join(', ')
        )
      : el('span', { className: 'card-table-muted' }, 'No one assigned yet')
  );

  const card = el('div', { className: 'card', style: 'margin-bottom:0.75rem' },
    el('div', {},
      el('p', { style: 'margin:0;font-size:1.05rem;font-weight:600' }, area.title),
      area.description
        ? el('p', { style: 'margin:0.35rem 0 0;color:var(--color-text-muted)' }, area.description)
        : null,
      responsible
    ),
    el('div', { className: 'task-actions' },
      el('button', { className: 'btn btn-secondary', type: 'button' }, 'Edit'),
      el('button', { className: 'btn btn-danger', type: 'button' }, 'Delete')
    )
  );

  card.querySelector('.btn-secondary')?.addEventListener('click', () => {
    const form = createAreaForm(profiles, async () => { close(); await refresh(); }, area, assigneeIds);
    const close = showModal('Edit Responsibility Area', form);
  });

  card.querySelector('.btn-danger')?.addEventListener('click', async () => {
    if (await confirmDialog('Delete this responsibility area?')) {
      await api.deleteResponsibilityArea(area.id);
      await refresh();
    }
  });

  return card;
}

function createAreaForm(
  profiles: Profile[],
  onSuccess: () => void,
  existing?: ResponsibilityArea,
  assignedIds: string[] = []
): HTMLElement {
  const session = getSession();
  const form = el('form', { className: 'modal-body task-form' });

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'area-title' }, 'Area'),
      el('input', {
        type: 'text',
        id: 'area-title',
        required: 'true',
        placeholder: 'e.g. Finances, Medical appointments',
        value: existing?.title ?? '',
      })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'area-desc' }, 'Description (optional)'),
      el('textarea', { id: 'area-desc', placeholder: 'What does this person handle?' },
        existing?.description ?? '')
    )
  );

  const assignGroup = el('div', { className: 'form-group caregiver-select-group' },
    el('label', { for: 'area-assign' }, 'Responsible person'),
    el('button', { type: 'button', id: 'area-assign-toggle', className: 'caregiver-select-toggle' }, 'Select people'),
    el('div', { id: 'area-assign-menu', className: 'caregiver-select-menu', hidden: 'true' }),
    el('small', { className: 'input-hint' }, 'Choose who is responsible for this area of care.')
  );
  const assignToggle = assignGroup.querySelector('#area-assign-toggle') as HTMLButtonElement;
  const assignMenu = assignGroup.querySelector('#area-assign-menu') as HTMLDivElement;
  const caregivers = profiles.filter((p) => p.persona !== 'mother');
  const selectedCaregiverIds = new Set(assignedIds);

  const updateAssignLabel = () => {
    if (selectedCaregiverIds.size === 0) {
      assignToggle.textContent = 'Select people';
      return;
    }
    const names = caregivers
      .filter((p) => selectedCaregiverIds.has(p.id))
      .map((p) => p.display_name);
    assignToggle.textContent = `${names.length} selected: ${names.join(', ')}`;
  };

  assignToggle.addEventListener('click', () => {
    const isOpen = !assignMenu.hidden;
    assignMenu.hidden = isOpen;
    assignToggle.classList.toggle('open', !isOpen);
  });

  form.addEventListener('click', (event) => {
    if (!assignGroup.contains(event.target as Node)) {
      assignMenu.hidden = true;
      assignToggle.classList.remove('open');
    }
  });

  for (const p of caregivers) {
    const row = el(
      'label',
      { className: 'caregiver-select-option' },
      el('input', { type: 'checkbox', value: p.id, checked: assignedIds.includes(p.id) ? 'true' : undefined }),
      el('span', {}, formatUserOptionLabel(p))
    );
    const checkbox = row.querySelector('input') as HTMLInputElement;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedCaregiverIds.add(p.id);
      } else {
        selectedCaregiverIds.delete(p.id);
      }
      updateAssignLabel();
    });
    assignMenu.append(row);
  }
  if (caregivers.length === 0) {
    assignToggle.disabled = true;
    assignToggle.textContent = 'No people available';
  }
  updateAssignLabel();
  form.append(assignGroup);

  const errorEl = el('p', { style: 'color:var(--color-danger);display:none' });
  form.append(errorEl, el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, existing ? 'Save' : 'Create'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (selectedCaregiverIds.size === 0) {
      errorEl.textContent = 'Please assign at least one person.';
      errorEl.style.display = 'block';
      return;
    }

    const areaData = {
      title: (form.querySelector('#area-title') as HTMLInputElement).value.trim(),
      description: (form.querySelector('#area-desc') as HTMLTextAreaElement).value.trim() || null,
      created_by: session.profile?.id ?? null,
    };

    try {
      let areaId = existing?.id;
      if (existing) {
        await api.updateResponsibilityArea(existing.id, areaData);
      } else {
        const created = await api.createResponsibilityArea(areaData);
        areaId = created.id;
      }

      if (areaId) {
        const selected = [...selectedCaregiverIds];
        const currentAssignments = existing
          ? (await api.getResponsibilityAssignments()).filter((a) => a.area_id === areaId)
          : [];

        for (const a of currentAssignments) {
          if (!selected.includes(a.profile_id)) {
            await api.unassignResponsibility(areaId, a.profile_id);
          }
        }
        for (const profileId of selected) {
          if (!currentAssignments.some((a) => a.profile_id === profileId)) {
            await api.assignResponsibility(areaId, profileId);
          }
        }
      }

      onSuccess();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Failed to save';
      errorEl.style.display = 'block';
    }
  });

  return form;
}

function formatUserOptionLabel(profile: Profile): string {
  const role = PERSONA_LABELS[profile.persona as Persona];
  return `${profile.display_name} (${role})`;
}
