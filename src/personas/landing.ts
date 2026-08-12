import type { Persona } from '../shared/types';
import { PERSONA_LABELS } from '../shared/types';
import {
  signInAsPersona,
  signInAsMotherWithPin,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  getSession,
  refreshSessionFromSupabase,
  isAdminProfile,
  isAuthenticated,
  isMotherPinVerified,
  restorePersonaFromProfile,
} from '../shared/auth';
import { navigate, personaHome, MODULE_SELECT_PATH } from '../shared/router';
import { el } from '../shared/utils';
import { icon } from '../shared/icons';
import { isSupabaseConfigured } from '../shared/supabase';
import { promptMotherPin } from '../shared/pin';

const PERSONA_CONFIG: { persona: Persona; iconName: 'home' | 'settings' | 'users' | 'briefcase'; desc: string }[] = [
  { persona: 'mother', iconName: 'home', desc: 'Your daily hub' },
  { persona: 'admin', iconName: 'settings', desc: 'Coordinate everything' },
  { persona: 'family_caregiver', iconName: 'users', desc: 'Family visits & tasks' },
  { persona: 'hired_caregiver', iconName: 'briefcase', desc: 'Visit tasks & notes' },
];

export async function renderLanding(): Promise<void> {
  const app = document.getElementById('app')!;
  let session = getSession();

  if (!session.persona && isSupabaseConfigured) {
    await refreshSessionFromSupabase();
    session = getSession();
  }

  if (session.persona && (session.persona !== 'mother' || isMotherPinVerified())) {
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
    el('p', {}, 'Family care coordination for your household')
  );

  const loginCard = el('div', { className: 'login-card' },
    el('h2', { className: 'login-card-title' }, icon('mail'), el('span', {}, 'Sign in'))
  );

  if (isSupabaseConfigured) {
    loginCard.append(
      el('p', { className: 'login-card-hint' },
        'Accounts are created by your family admin. Sign in with the email and password they provided.'
      ),
      createEmailLoginForm()
    );
  } else {
    loginCard.append(createEmailAccessPanel());
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

  const altAccess = el('div', { className: 'landing-alt-access' });

  const momTabletBtn = el('button', { className: 'btn btn-ghost btn-block', type: 'button' },
    icon('home'),
    "Mom's tablet"
  );
  momTabletBtn.addEventListener('click', async () => {
    const ok = await promptMotherPin();
    if (!ok) return;
    await signInAsMotherWithPin();
    await navigate('/mother');
  });
  altAccess.append(momTabletBtn);

  if (isAuthenticated()) {
    const personaAccessBtn = el('button', { className: 'btn btn-ghost btn-block', type: 'button' },
      icon('users'),
      'Choose persona'
    );
    personaAccessBtn.addEventListener('click', () => navigate(MODULE_SELECT_PATH));
    altAccess.append(personaAccessBtn);
  }

  footer.append(altAccess);
  container.append(hero, loginCard, footer);
  app.replaceChildren(container);
}

export async function renderModuleSelect(): Promise<void> {
  const app = document.getElementById('app')!;
  const session = getSession();

  if (!isAuthenticated()) {
    await navigate('/');
    return;
  }

  if (session.persona && !isAdminProfile()) {
    await navigate(personaHome(session.persona));
    return;
  }

  const container = el('div', { className: 'landing page-enter' });

  const logoMark = el('div', { className: 'landing-logo' },
    el('div', { className: 'landing-logo-mark' }, icon('heart')),
    el('h1', {}, "Mom's Care")
  );

  const subtitle = isAdminProfile()
    ? 'Preview the app as each family member — your account stays signed in'
    : 'Choose who you are today';

  const hero = el('div', { className: 'landing-hero' },
    logoMark,
    el('p', {}, subtitle)
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

    btn.addEventListener('click', () => switchToPersona(config.persona));
    grid.append(btn);
  }

  const footer = el('div', { className: 'landing-footer' });

  if (isAdminProfile()) {
    const backBtn = el('button', { className: 'btn btn-secondary btn-block', type: 'button' },
      icon('arrow-right'),
      'Return to Admin'
    );
    backBtn.addEventListener('click', () => {
      if (restorePersonaFromProfile()) {
        navigate(personaHome('admin'));
      }
    });
    footer.append(backBtn);
  }

  if (isAuthenticated()) {
    const signOutBtn = el('button', { className: 'btn btn-ghost btn-block', type: 'button' },
      icon('log-out'),
      'Sign out'
    );
    signOutBtn.addEventListener('click', async () => {
      await signOut();
      navigate('/');
    });
    footer.append(signOutBtn);
  }

  if (!isAdminProfile()) {
    const backBtn = el('button', { className: 'btn btn-ghost btn-block', type: 'button' },
      icon('arrow-right'),
      'Back to sign in'
    );
    backBtn.addEventListener('click', () => navigate('/'));
    footer.append(backBtn);
  }

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

async function switchToPersona(persona: Persona): Promise<void> {
  try {
    const ok = await signInAsPersona(persona);
    if (ok) {
      await navigate(personaHome(persona));
    }
  } catch (err) {
    console.error('Persona switch failed:', err);
  }
}
