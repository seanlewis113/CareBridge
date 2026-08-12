import { api } from './api';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { el, showModal } from './utils';

export const DEFAULT_MOTHER_PIN = '1023';
export const DEFAULT_ADMIN_SWITCH_PIN = '1023';

const PIN_LENGTH = 4;

function isPinRpcMissing(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? '';
  return (
    error.code === 'PGRST202' ||
    /could not find the function|function .* does not exist/i.test(message)
  );
}

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
  if (isSupabaseConfigured) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (getSupabase() as any).rpc('verify_mother_pin', { input_pin: pin });
    if (error) {
      if (isPinRpcMissing(error)) {
        return pin === DEFAULT_MOTHER_PIN;
      }
      throw error;
    }
    return !!data;
  }
  const settings = await api.getSettings();
  return pinMatches(settings.mother_pin_hash, pin, DEFAULT_MOTHER_PIN);
}

export async function verifyAdminSwitchPin(pin: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (getSupabase() as any).rpc('verify_admin_switch_pin', { input_pin: pin });
    if (error) {
      if (isPinRpcMissing(error)) {
        return pin === DEFAULT_ADMIN_SWITCH_PIN;
      }
      throw error;
    }
    return !!data;
  }
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

    let submitting = false;

    const clearPin = () => {
      inputs.forEach((item) => {
        item.value = '';
      });
      inputs[0].focus();
    };

    const showPinError = (message: string) => {
      void api.logActivity('auth.pin_fail', { metadata: { context: title } });
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      clearPin();
    };

    const trySubmit = async () => {
      const pin = inputs.map((input) => input.value).join('');
      if (pin.length !== PIN_LENGTH || submitting) return;

      submitting = true;
      try {
        const ok = await verify(pin);
        if (ok) {
          void api.logActivity('auth.pin_verify', { metadata: { context: title } });
          finish(true);
          return;
        }
        showPinError('Incorrect PIN. Try again.');
      } catch {
        showPinError('Unable to verify PIN. Try again.');
      } finally {
        submitting = false;
      }
    };

    const fillDigits = (digits: string, startIndex = 0) => {
      const normalized = digits.replace(/\D/g, '').slice(0, PIN_LENGTH);
      normalized.split('').forEach((digit, offset) => {
        const target = inputs[startIndex + offset];
        if (target) target.value = digit;
      });

      const nextIndex = Math.min(startIndex + normalized.length, PIN_LENGTH - 1);
      inputs[nextIndex]?.focus();

      if (inputs.every((item) => item.value.length === 1)) {
        void trySubmit();
      }
    };

    inputs.forEach((input, index) => {
      input.addEventListener('focus', () => {
        requestAnimationFrame(() => input.select());
      });
      input.addEventListener('click', () => {
        input.select();
      });
      input.addEventListener('paste', (event) => {
        event.preventDefault();
        errorEl.style.display = 'none';
        fillDigits(event.clipboardData?.getData('text') ?? '', index);
      });
      input.addEventListener('input', () => {
        errorEl.style.display = 'none';
        input.value = input.value.replace(/\D/g, '').slice(-1);
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
