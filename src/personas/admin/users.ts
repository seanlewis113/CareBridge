import { api } from '../../shared/api';
import { inviteUserByAdmin, getSession, hasSupabaseAuth } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, showModal } from '../../shared/utils';
import { PERSONA_LABELS, type Persona, type Profile } from '../../shared/types';
import { isSupabaseConfigured } from '../../shared/supabase';

const MANAGEABLE_PERSONAS: Extract<Persona, 'admin' | 'family_caregiver' | 'hired_caregiver'>[] = [
  'admin',
  'family_caregiver',
  'hired_caregiver',
];

export async function renderAdminUsers(): Promise<void> {
  const content = el('div', {});

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
      el('h2', {}, 'Users'),
      isSupabaseConfigured
        ? el('button', { className: 'btn btn-primary', type: 'button', id: 'new-user' }, '+ Add User')
        : null
    ),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1.5rem;font-size:0.95rem' },
      'Add family members and admins. They\'ll get an email link to activate their account — no Supabase dashboard needed.'
    )
  );

  if (!isSupabaseConfigured) {
    content.append(el('p', { className: 'empty-state' }, 'User management requires Supabase.'));
    renderAdminShell(content, '/admin/users');
    return;
  }

  const canEditRoles = await hasSupabaseAuth();
  if (!canEditRoles) {
    content.append(
      el('div', { className: 'card', style: 'margin-bottom:1rem;border-color:var(--color-warning,#d97706)' },
        el('p', { style: 'margin:0;font-size:0.95rem' },
          'Sign in with your admin email and password to change user roles. You can still invite new users below.'
        )
      )
    );
  }

  const profiles = (await api.getProfiles()).filter((p) => p.persona !== 'mother');
  const list = el('div', { className: 'user-list' });

  if (profiles.length === 0) {
    list.append(el('p', { className: 'empty-state' }, 'No users yet. Add your first family member or admin.'));
  } else {
    for (const profile of profiles) {
      list.append(renderUserCard(profile, canEditRoles, () => renderAdminUsers()));
    }
  }

  content.append(list);
  renderAdminShell(content, '/admin/users');

  document.getElementById('new-user')?.addEventListener('click', () => {
    const form = createUserForm(async () => {
      close();
      await renderAdminUsers();
    });
    const close = showModal('Add User', form);
  });
}

function renderUserCard(profile: Profile, canEditRoles: boolean, refresh: () => void): HTMLElement {
  const session = getSession();
  const isSelf = session.profile?.id === profile.id;

  const card = el('div', { className: 'card user-card', style: 'margin-bottom:0.75rem' });

  const info = el('div', { className: 'user-card-info' },
    el('h3', { style: 'margin:0 0 0.25rem' }, profile.display_name),
    el('p', { style: 'margin:0;color:var(--color-text-muted);font-size:0.9rem' }, profile.email ?? 'No email')
  );

  const roleSelect = el('select', { id: `role-${profile.id}`, style: 'min-width:160px' });
  for (const persona of MANAGEABLE_PERSONAS) {
    roleSelect.append(
      el('option', { value: persona, selected: profile.persona === persona ? 'true' : undefined }, PERSONA_LABELS[persona])
    );
  }
  if (isSelf || !canEditRoles) roleSelect.setAttribute('disabled', 'true');

  const status = el('p', { style: 'font-size:0.85rem;margin:0.5rem 0 0;min-height:1.2em' });

  roleSelect.addEventListener('change', async () => {
    const persona = roleSelect.value as typeof MANAGEABLE_PERSONAS[number];
    try {
      await api.upsertProfile({ ...profile, persona });
      status.textContent = 'Role updated.';
      status.style.color = 'var(--color-success)';
      refresh();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Update failed.';
      status.style.color = 'var(--color-danger)';
      roleSelect.value = profile.persona;
    }
  });

  const actions = el('div', { className: 'user-card-actions', style: 'display:flex;flex-direction:column;align-items:flex-end;gap:0.25rem' },
    el('label', { style: 'font-size:0.8rem;color:var(--color-text-muted)' }, 'Role'),
    roleSelect,
    isSelf ? el('span', { style: 'font-size:0.8rem;color:var(--color-text-muted)' }, 'Your account') : null,
    status
  );

  card.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:1rem' }, info, actions)
  );

  return card;
}

function createUserForm(onSuccess: () => void): HTMLElement {
  const form = el('form', {});

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'user-name' }, 'Display name'),
      el('input', { type: 'text', id: 'user-name', required: 'true', placeholder: 'Jane Doe' })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'user-email' }, 'Email'),
      el('input', { type: 'email', id: 'user-email', required: 'true', placeholder: 'you@email.com' })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'user-role' }, 'Role'),
      el('select', { id: 'user-role' },
        el('option', { value: 'family_caregiver' }, 'Family Caregiver'),
        el('option', { value: 'hired_caregiver' }, 'Hired Caregiver'),
        el('option', { value: 'admin' }, 'Admin')
      )
    ),
    el('p', { style: 'font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.75rem' },
      'They\'ll receive an email with a link to set up their account.'
    ),
    el('p', { id: 'user-form-status', style: 'font-size:0.9rem;margin-bottom:0.75rem' }),
    el('button', { className: 'btn btn-primary', type: 'submit' }, 'Send Invite')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('#user-form-status') as HTMLElement;
    const displayName = (form.querySelector('#user-name') as HTMLInputElement).value.trim();
    const email = (form.querySelector('#user-email') as HTMLInputElement).value.trim();
    const persona = (form.querySelector('#user-role') as HTMLSelectElement).value as 'admin' | 'family_caregiver' | 'hired_caregiver';

    if (!displayName) {
      status.textContent = 'Please enter a display name.';
      status.style.color = 'var(--color-danger)';
      return;
    }

    try {
      await inviteUserByAdmin(email, displayName, persona);
      status.textContent = `Invite sent to ${email}. They should check their inbox.`;
      status.style.color = 'var(--color-success)';
      setTimeout(onSuccess, 1200);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Could not send invite.';
      status.style.color = 'var(--color-danger)';
    }
  });

  return form;
}
