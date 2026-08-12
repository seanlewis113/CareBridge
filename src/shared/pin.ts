import { api } from './api';
import { el, showModal } from './utils';

export const DEFAULT_MOTHER_PIN = '1023';
export const DEFAULT_ADMIN_SWITCH_PIN = '1023';

const PIN_LENGTH = 4;

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function pinMatches(storedHash: string | null, pin: string, defaultPin: string): Promise<boolean> {
  if (storedHash) {
    const hash = await hashPin(pin);
    return hash === storedHash;
  }
  return pin === defaultPin;
}

export async function verifyMotherPin(pin: string): Promise<boolean> {
  const settings = await api.getSettings();
  return pinMatches(settings.mother_pin_hash, pin, DEFAULT_MOTHER_PIN);
}

export async function verifyAdminSwitchPin(pin: string): Promise<boolean> {
  const settings = await api.getSettings();
  return pinMatches(settings.admin_switch_pin_hash, pin, DEFAULT_ADMIN_SWITCH_PIN);
}

function promptPin(
  title: string,
  subtitle: string,
  verify: (pin: string) => Promise<boolean>
): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const errorEl = el('p', {
      className: 'error-msg',
      style: 'color:var(--color-danger);display:none;text-align:center',
    });

    const digitsContainer = el('div', { className: 'pin-digits' });
    const inputs: HTMLInputElement[] = [];

    for (let i = 0; i < PIN_LENGTH; i++) {
      const input = el('input', {
        className: 'pin-digit',
        type: 'password',
        inputmode: 'numeric',
        maxlength: '1',
        'aria-label': `PIN digit ${i + 1}`,
        autocomplete: 'off',
      }) as HTMLInputElement;
      inputs.push(input);
      digitsContainer.append(input);
    }

    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      close();
      resolve(result);
    };

    const trySubmit = async () => {
      const pin = inputs.map((input) => input.value).join('');
      if (pin.length !== PIN_LENGTH) return;

      const ok = await verify(pin);
      if (ok) {
        void api.logActivity('auth.pin_verify', { metadata: { context: title } });
        finish(true);
        return;
      }

      void api.logActivity('auth.pin_fail', { metadata: { context: title } });
      errorEl.textContent = 'Incorrect PIN. Try again.';
      errorEl.style.display = 'block';
      inputs.forEach((input) => {
        input.value = '';
      });
      inputs[0].focus();
    };

    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        errorEl.style.display = 'none';
        if (input.value.length === 1 && index < PIN_LENGTH - 1) {
          inputs[index + 1].focus();
        }
        if (inputs.every((item) => item.value.length === 1)) {
          void trySubmit();
        }
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && index > 0) {
          inputs[index - 1].focus();
        }
      });
    });

    const body = el(
      'div',
      { className: 'modal-body' },
      el('p', { style: 'text-align:center;color:var(--color-text-muted)' }, subtitle),
      digitsContainer,
      errorEl
    );

    const close = showModal(title, body, () => {
      if (!resolved) resolve(false);
    });

    inputs[0].focus();
  });
}

export function promptMotherPin(): Promise<boolean> {
  return promptPin(
    "Enter Mom's PIN",
    'Enter the 4-digit PIN to open the hub.',
    verifyMotherPin
  );
}

export function promptAdminSwitchPin(): Promise<boolean> {
  return promptPin(
    'Family login',
    "Enter the family PIN to leave Mom's view.",
    verifyAdminSwitchPin
  );
}
