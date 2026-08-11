import { api } from '../../shared/api';
import { setMotherPin, setAdminSwitchPin, setFinancialPin } from '../../shared/auth';
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
    el('hr', { style: 'margin:1.5rem 0;border:none;border-top:1px solid var(--color-border)' }),
    el('h3', {}, 'PINs'),
    el('p', { style: 'font-size:0.9rem;color:var(--color-text-muted)' },
      'Set PINs for tablet access and financial security. Leave blank to keep current PIN.'
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'mother-pin' }, "Mom's tablet PIN"),
      el('input', { type: 'password', id: 'mother-pin', inputmode: 'numeric', placeholder: '••••' })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'switch-pin' }, 'Persona switch PIN'),
      el('input', { type: 'password', id: 'switch-pin', inputmode: 'numeric', placeholder: '••••' })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'finance-pin' }, 'Financial PIN'),
      el('input', { type: 'password', id: 'finance-pin', inputmode: 'numeric', placeholder: '••••••' })
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

    const motherPin = (form.querySelector('#mother-pin') as HTMLInputElement).value;
    const switchPin = (form.querySelector('#switch-pin') as HTMLInputElement).value;
    const financePin = (form.querySelector('#finance-pin') as HTMLInputElement).value;

    if (motherPin) await setMotherPin(motherPin);
    if (switchPin) await setAdminSwitchPin(switchPin);
    if (financePin) await setFinancialPin(financePin);

    status.textContent = 'Settings saved.';
    status.style.color = 'var(--color-success)';
  });

  document.getElementById('connect-google')?.addEventListener('click', () => {
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

  renderAdminShell(content, '/admin/settings');
}
