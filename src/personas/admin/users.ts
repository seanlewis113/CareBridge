import { api } from '../../shared/api';
import { createUserByAdmin, getSession, hasSupabaseAuth } from '../../shared/auth';
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

  const canManageUsers = isSupabaseConfigured ? await hasSupabaseAuth() : false;

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem' },
      el('h2', {}, 'Users'),
      isSupabaseConfigured && canManageUsers
        ? el('button', { className: 'btn btn-primary', type: 'button', id: 'new-user' }, '+ Add User')
        : null
    ),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1.5rem;font-size:0.95rem' },
      'Add family members and admins with an email and password. Share those credentials with them privately — no invitation email is sent.'
    )
  );

  if (!isSupabaseConfigured) {
    content.append(el('p', { className: 'empty-state' }, 'User management requires Supabase.'));
    renderAdminShell(content, '/admin/users');
    return;
  }

  if (!canManageUsers) {
    content.append(
      el('div', { className: 'card', style: 'margin-bottom:1rem;border-color:var(--color-warning,#d97706)' },
        el('p', { style: 'margin:0;font-size:0.95rem' },
          'Sign in with your admin email and password on the home screen to add users or change roles.'
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
      list.append(renderUserCard(profile, canManageUsers, () => renderAdminUsers()));
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
  const form = el('form', { className: 'modal-body' });

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
    el('div', { className: 'form-group' },
      el('label', { for: 'user-password' }, 'Password'),
      el('input', {
        type: 'password',
        id: 'user-password',
        required: 'true',
        minlength: '8',
        autocomplete: 'new-password',
        placeholder: 'At least 8 characters',
      })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'user-password-confirm' }, 'Confirm password'),
      el('input', {
        type: 'password',
        id: 'user-password-confirm',
        required: 'true',
        minlength: '8',
        autocomplete: 'new-password',
      })
    ),
    el('p', { style: 'font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.75rem' },
      'Tell them their email and this password in person, by phone, or another private channel.'
    ),
    el('p', { id: 'user-form-status', style: 'font-size:0.9rem;margin-bottom:0.75rem' }),
    el('button', { className: 'btn btn-primary', type: 'submit' }, 'Add User')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('#user-form-status') as HTMLElement;
    const displayName = (form.querySelector('#user-name') as HTMLInputElement).value.trim();
    const email = (form.querySelector('#user-email') as HTMLInputElement).value.trim();
    const persona = (form.querySelector('#user-role') as HTMLSelectElement).value as 'admin' | 'family_caregiver' | 'hired_caregiver';
    const password = (form.querySelector('#user-password') as HTMLInputElement).value;
    const confirm = (form.querySelector('#user-password-confirm') as HTMLInputElement).value;

    if (!displayName) {
      status.textContent = 'Please enter a display name.';
      status.style.color = 'var(--color-danger)';
      return;
    }
    if (password.length < 8) {
      status.textContent = 'Password must be at least 8 characters.';
      status.style.color = 'var(--color-danger)';
      return;
    }
    if (password !== confirm) {
      status.textContent = 'Passwords do not match.';
      status.style.color = 'var(--color-danger)';
      return;
    }

    try {
      await createUserByAdmin(email, password, displayName, persona);
      status.textContent = `${displayName} was added. Share their email and password securely.`;
      status.style.color = 'var(--color-success)';
      setTimeout(onSuccess, 1500);
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Could not add user.';
      status.style.color = 'var(--color-danger)';
    }
  });

  return form;
}
