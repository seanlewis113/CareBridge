import { api } from '../../shared/api';
import { renderAdminShell } from '../shared/shell';
import { el } from '../../shared/utils';
import { isSupabaseConfigured } from '../../shared/supabase';

export async function renderAdminSettings(): Promise<void> {
  const settings = await api.getSettings();
  const content = el('div', {});

  content.append(el('h2', {}, 'Settings'));

  const form = el('form', { className: 'card', style: 'max-width:520px' });

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'mother-name' }, "Mom's display name"),
      el('input', { type: 'text', id: 'mother-name', value: settings.mother_name })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'text-scale' }, 'Text scale on Mom\'s hub'),
      el('input', { type: 'range', id: 'text-scale', min: '1', max: '1.8', step: '0.1', value: String(settings.text_scale) }),
      el('span', { id: 'scale-val' }, `${settings.text_scale}x`)
    ),
    el('p', { id: 'settings-status', style: 'font-size:0.9rem' }),
    el('button', { className: 'btn btn-primary', type: 'submit' }, 'Save Settings')
  );

  if (isSupabaseConfigured) {
    form.append(
      el('hr', { style: 'margin:1.5rem 0;border:none;border-top:1px solid var(--color-border)' }),
      el('h3', {}, 'Google Calendar'),
      el('p', { style: 'font-size:0.9rem;color:var(--color-text-muted)' },
        'Connect Mom\'s Google account to sync calendar events.'
      ),
      el('button', {
        className: 'btn btn-secondary',
        type: 'button',
        id: 'connect-google',
        style: 'margin-top:0.5rem',
      }, settings.google_refresh_token ? 'Reconnect Google Calendar' : 'Connect Google Calendar')
    );
  }

  content.append(form);

  form.querySelector('#text-scale')?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    const label = form.querySelector('#scale-val');
    if (label) label.textContent = `${val}x`;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('#settings-status') as HTMLElement;

    await api.updateSettings({
      mother_name: (form.querySelector('#mother-name') as HTMLInputElement).value.trim() || 'Mom',
      text_scale: parseFloat((form.querySelector('#text-scale') as HTMLInputElement).value),
    });

    status.textContent = 'Settings saved.';
    status.style.color = 'var(--color-success)';
  });

  renderAdminShell(content, '/admin/settings');

  const status = form.querySelector('#settings-status') as HTMLElement | null;
  const oauthError = sessionStorage.getItem('google-oauth-error');
  const oauthSuccess = sessionStorage.getItem('google-oauth-success');
  if (status && oauthError) {
    status.textContent = `Google Calendar connection failed: ${oauthError}`;
    status.style.color = 'var(--color-danger, #c0392b)';
    sessionStorage.removeItem('google-oauth-error');
  } else if (status && oauthSuccess) {
    status.textContent = 'Google Calendar connected successfully.';
    status.style.color = 'var(--color-success)';
    sessionStorage.removeItem('google-oauth-success');
  }

  form.querySelector('#connect-google')?.addEventListener('click', () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || clientId === 'your-google-client-id') {
      alert('Set VITE_GOOGLE_CLIENT_ID in your .env file first.');
      return;
    }
    const redirectUri = `${window.location.origin}/google-callback`;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar');
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
    window.location.href = url;
  });
}
