import type { Persona } from '../shared/types';
import { PERSONA_LABELS } from '../shared/types';
import { signInAsPersona, signInWithEmail, signUpWithEmail, getSession, refreshSessionFromSupabase } from '../shared/auth';
import { navigate, personaHome } from '../shared/router';
import { el, showModal } from '../shared/utils';
import { icon } from '../shared/icons';
import { isSupabaseConfigured } from '../shared/supabase';

const PERSONA_CONFIG: { persona: Persona; iconName: 'home' | 'settings' | 'users' | 'briefcase'; desc: string; needsPin: boolean }[] = [
  { persona: 'mother', iconName: 'home', desc: 'Your daily hub', needsPin: true },
  { persona: 'admin', iconName: 'settings', desc: 'Coordinate everything', needsPin: true },
  { persona: 'family_caregiver', iconName: 'users', desc: 'Family visits & tasks', needsPin: true },
  { persona: 'hired_caregiver', iconName: 'briefcase', desc: 'Visit tasks & notes', needsPin: true },
];

export async function renderLanding(): Promise<void> {
  const app = document.getElementById('app')!;
  let session = getSession();

  if (!session.persona && isSupabaseConfigured) {
    await refreshSessionFromSupabase();
    session = getSession();
  }

  if (session.persona) {
    await navigate(personaHome(session.persona));
    return;
  }

  const container = el('div', { className: 'landing page-enter' });

  const logoMark = el('div', { className: 'landing-logo' },
    el('div', { className: 'landing-logo-mark' }, icon('heart')),
    el('h1', {}, "Mom's Care")
  );

  const hero = el('div', { className: 'landing-hero' },
    logoMark,
    el('p', {}, 'Family care coordination — choose who you are today')
  );

  const grid = el('div', { className: 'persona-grid' });

  for (const config of PERSONA_CONFIG) {
    const iconWrap = el('div', { className: 'persona-btn-icon' }, icon(config.iconName));
    const btn = el('button', {
      className: 'persona-btn',
      type: 'button',
      'aria-label': `Sign in as ${PERSONA_LABELS[config.persona]}`,
    },
      iconWrap,
      el('span', { className: 'persona-btn-label' }, PERSONA_LABELS[config.persona]),
      el('span', { className: 'persona-btn-desc' }, config.desc)
    );

    btn.addEventListener('click', () => showPersonaLogin(config.persona, config.needsPin));
    grid.append(btn);
  }

  const footer = el('div', { className: 'landing-footer' });
  if (!isSupabaseConfigured) {
    footer.append(
      el('div', { className: 'landing-demo-badge' },
        icon('sparkles'),
        'Demo mode — data saved locally'
      )
    );
  }

  const emailSection = el('details', { className: 'email-login' });
  emailSection.append(
    el('summary', {}, icon('mail'), el('span', {}, 'Family account access')),
    createEmailAccessPanel()
  );
  footer.append(emailSection);

  container.append(hero, grid, footer);
  app.replaceChildren(container);
}

function createEmailAccessPanel(): HTMLElement {
  const wrapper = el('div', { className: 'email-access-panel' });
  const tabBar = el('div', { className: 'email-auth-tabs' });
  const signInTab = el('button', { type: 'button', className: 'email-auth-tab active' }, 'Sign in');
  const signUpTab = el('button', { type: 'button', className: 'email-auth-tab' }, 'Sign up');
  tabBar.append(signInTab, signUpTab);

  const signInForm = createEmailLoginForm();
  const signUpForm = createEmailSignupForm();
  signUpForm.style.display = 'none';

  signInTab.addEventListener('click', () => {
    signInTab.classList.add('active');
    signUpTab.classList.remove('active');
    signInForm.style.display = '';
    signUpForm.style.display = 'none';
  });

  signUpTab.addEventListener('click', () => {
    signUpTab.classList.add('active');
    signInTab.classList.remove('active');
    signUpForm.style.display = '';
    signInForm.style.display = 'none';
  });

  wrapper.append(tabBar, signInForm, signUpForm);
  return wrapper;
}

function createEmailLoginForm(): HTMLElement {
  const form = el('form', { className: 'pin-form', style: 'margin-top:1rem' });
  const emailGroup = el('div', { className: 'form-group' },
    el('label', { for: 'email' }, 'Email'),
    el('input', { type: 'email', id: 'email', name: 'email', required: 'true', placeholder: 'you@email.com' })
  );
  const passGroup = el('div', { className: 'form-group' },
    el('label', { for: 'password' }, 'Password'),
    el('input', { type: 'password', id: 'password', name: 'password', required: 'true' })
  );
  const errorEl = el('p', { className: 'error-msg', style: 'color:var(--color-danger);display:none' });
  const submitBtn = el('button', { className: 'btn btn-primary btn-block', type: 'submit' },
    icon('arrow-right'),
    'Sign in'
  );

  form.append(emailGroup, passGroup, errorEl, submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (form.querySelector('#email') as HTMLInputElement).value;
    const password = (form.querySelector('#password') as HTMLInputElement).value;
    try {
      const profile = await signInWithEmail(email, password);
      if (profile) {
        await navigate(personaHome(profile.persona));
      }
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Sign in failed';
      errorEl.style.display = 'block';
    }
  });

  return form;
}

function createEmailSignupForm(): HTMLElement {
  const form = el('form', { className: 'pin-form', style: 'margin-top:1rem' });
  const nameGroup = el('div', { className: 'form-group' },
    el('label', { for: 'signup-name' }, 'Display name'),
    el('input', { type: 'text', id: 'signup-name', name: 'signup-name', required: 'true', placeholder: 'Jane Doe' })
  );
  const emailGroup = el('div', { className: 'form-group' },
    el('label', { for: 'signup-email' }, 'Email'),
    el('input', { type: 'email', id: 'signup-email', name: 'signup-email', required: 'true', placeholder: 'you@email.com' })
  );
  const roleGroup = el('div', { className: 'form-group' },
    el('label', { for: 'signup-role' }, 'Role'),
    el('select', { id: 'signup-role', name: 'signup-role' },
      el('option', { value: 'family_caregiver' }, 'Family Caregiver'),
      el('option', { value: 'hired_caregiver' }, 'Hired Caregiver')
    )
  );
  const passGroup = el('div', { className: 'form-group' },
    el('label', { for: 'signup-password' }, 'Password'),
    el('input', { type: 'password', id: 'signup-password', name: 'signup-password', required: 'true', minlength: '8' })
  );
  const statusEl = el('p', { className: 'error-msg', style: 'display:none' });
  const submitBtn = el('button', { className: 'btn btn-secondary btn-block', type: 'submit' },
    icon('users'),
    'Create account'
  );

  form.append(nameGroup, emailGroup, roleGroup, passGroup, statusEl, submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.style.display = 'none';

    const displayName = (form.querySelector('#signup-name') as HTMLInputElement).value.trim();
    const email = (form.querySelector('#signup-email') as HTMLInputElement).value.trim();
    const password = (form.querySelector('#signup-password') as HTMLInputElement).value;
    const persona = (form.querySelector('#signup-role') as HTMLSelectElement).value as 'family_caregiver' | 'hired_caregiver';

    if (!displayName) {
      statusEl.textContent = 'Please enter your name.';
      statusEl.style.color = 'var(--color-danger)';
      statusEl.style.display = 'block';
      return;
    }

    try {
      const result = await signUpWithEmail(email, password, displayName, persona);
      statusEl.textContent = result.needsEmailConfirmation
        ? 'Check your email to confirm your account, then sign in.'
        : 'Account created. Signing you in...';
      statusEl.style.color = 'var(--color-success)';
      statusEl.style.display = 'block';
      if (!result.needsEmailConfirmation) {
        await navigate(personaHome(persona));
      }
      form.reset();
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : 'Sign up failed';
      statusEl.style.color = 'var(--color-danger)';
      statusEl.style.display = 'block';
    }
  });

  return form;
}

function createPinDigits(container: HTMLElement, onComplete: (pin: string) => void): void {
  const digits = el('div', { className: 'pin-digits' });
  const inputs: HTMLInputElement[] = [];

  for (let i = 0; i < 4; i++) {
    const input = el('input', {
      type: 'password',
      className: 'pin-digit',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: '1',
      autocomplete: 'off',
      'aria-label': `PIN digit ${i + 1}`,
    }) as HTMLInputElement;

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value && i < 3) inputs[i + 1].focus();
      const pin = inputs.map((inp) => inp.value).join('');
      if (pin.length === 4) onComplete(pin);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        inputs[i - 1].focus();
      }
    });

    inputs.push(input);
    digits.append(input);
  }

  container.append(digits);
  setTimeout(() => inputs[0].focus(), 100);
}

function showPersonaLogin(persona: Persona, needsPin: boolean): void {
  const form = el('form', { className: 'pin-form modal-body' });
  const title = PERSONA_LABELS[persona];
  let currentPin = '';

  if (needsPin) {
    form.append(
      el('p', { style: 'text-align:center;color:var(--color-text-muted)' },
        persona === 'mother'
          ? 'Enter the PIN for Mom\'s tablet'
          : 'Enter the family PIN to continue'
      )
    );
    createPinDigits(form, (pin) => { currentPin = pin; });
    const hiddenPin = el('input', { type: 'hidden', id: 'pin', name: 'pin' });
    form.append(hiddenPin);
  }

  const errorEl = el('p', { className: 'error-msg', style: 'color:var(--color-danger);display:none;text-align:center' });
  const actions = el('div', { className: 'modal-actions' },
    el('button', { className: 'btn btn-secondary', type: 'button', id: 'cancel-pin' }, 'Cancel'),
    el('button', { className: 'btn btn-primary', type: 'submit' }, `Continue as ${title}`)
  );
  form.append(errorEl, actions);

  const close = showModal(`Sign in as ${title}`, form);

  form.querySelector('#cancel-pin')?.addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pinInput = form.querySelector('#pin') as HTMLInputElement | null;
    const pin = currentPin || pinInput?.value || '';
    const ok = await signInAsPersona(persona, pin);
    if (ok) {
      close();
      await navigate(personaHome(persona));
    } else {
      errorEl.textContent = 'Incorrect PIN. Try again.';
      errorEl.style.display = 'block';
    }
  });
}
