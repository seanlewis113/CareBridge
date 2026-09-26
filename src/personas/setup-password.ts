import {
  completeInvitedUserPasswordSetup,
  getSession,
  refreshSessionFromSupabase,
} from '../shared/auth';
import { navigate, personaHome } from '../shared/router';
import { el } from '../shared/utils';
import { icon } from '../shared/icons';

export async function renderSetupPassword(): Promise<void> {
  const app = document.getElementById('app')!;
  const session = getSession();

  const container = el('div', { className: 'landing page-enter' });

  const logoMark = el('div', { className: 'landing-logo' },
    el('div', { className: 'landing-logo-mark' }, icon('heart')),
    el('h1', {}, "Jeanne's Care Bridge")
  );

  const hero = el('div', { className: 'landing-hero' },
    logoMark,
    el('p', {}, session.profile?.display_name
      ? `Welcome, ${session.profile.display_name}!`
      : 'Welcome!')
  );

  const card = el('div', { className: 'login-card' },
    el('h2', { className: 'login-card-title' }, icon('mail'), el('span', {}, 'Set your password')),
    el('p', { className: 'login-card-hint' },
      'Choose a password so you can sign in with email and password next time. You only need to do this once.'
    ),
    createPasswordForm()
  );

  container.append(hero, card);
  app.replaceChildren(container);
}

function createPasswordForm(): HTMLElement {
  const form = el('form', { className: 'pin-form', style: 'margin-top:1rem' });

  const passGroup = el('div', { className: 'form-group' },
    el('label', { for: 'setup-password' }, 'Password'),
    el('input', {
      type: 'password',
      id: 'setup-password',
      name: 'setup-password',
      required: 'true',
      minlength: '8',
      autocomplete: 'new-password',
    })
  );
  const confirmGroup = el('div', { className: 'form-group' },
    el('label', { for: 'setup-password-confirm' }, 'Confirm password'),
    el('input', {
      type: 'password',
      id: 'setup-password-confirm',
      name: 'setup-password-confirm',
      required: 'true',
      minlength: '8',
      autocomplete: 'new-password',
    })
  );
  const errorEl = el('p', { className: 'error-msg', style: 'color:var(--color-danger);display:none' });
  const submitBtn = el('button', { className: 'btn btn-primary btn-block', type: 'submit' },
    icon('arrow-right'),
    'Save password and continue'
  );

  form.append(passGroup, confirmGroup, errorEl, submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const password = (form.querySelector('#setup-password') as HTMLInputElement).value;
    const confirm = (form.querySelector('#setup-password-confirm') as HTMLInputElement).value;

    if (password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.style.display = 'block';
      return;
    }
    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      await completeInvitedUserPasswordSetup(password);
      await refreshSessionFromSupabase();
      const profile = getSession().profile;
      if (profile) {
        await navigate(personaHome(profile.persona));
      } else {
        await navigate('/');
      }
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Could not save password.';
      errorEl.style.display = 'block';
    }
  });

  return form;
}
