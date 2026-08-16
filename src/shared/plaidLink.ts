const PLAID_SCRIPT_URL = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface PlaidLinkHandler {
  open: () => void;
  destroy: () => void;
}

interface PlaidLinkOptions {
  token: string;
  onSuccess: (publicToken: string) => void;
  onExit?: (error?: { display_message?: string; error_message?: string }) => void;
}

interface PlaidGlobal {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: unknown) => void;
    onExit?: (error: { display_message?: string; error_message?: string } | null, metadata: unknown) => void;
  }) => PlaidLinkHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadPlaidScript(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${PLAID_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Plaid Link')));
      if (window.Plaid) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = PLAID_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Plaid Link'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export async function openPlaidLink(options: PlaidLinkOptions): Promise<PlaidLinkHandler> {
  await loadPlaidScript();
  if (!window.Plaid) {
    throw new Error('Plaid Link is not available');
  }

  const handler = window.Plaid.create({
    token: options.token,
    onSuccess: (publicToken: string) => {
      options.onSuccess(publicToken);
    },
    onExit: (error) => {
      options.onExit?.(error ?? undefined);
    },
  });

  handler.open();
  return handler;
}
