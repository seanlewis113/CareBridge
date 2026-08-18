import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID') ?? '';
const PLAID_SECRET = Deno.env.get('PLAID_SECRET') ?? '';
const PLAID_ENV = Deno.env.get('PLAID_ENV') ?? 'sandbox';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const PLAID_BASE = PLAID_ENV === 'production'
  ? 'https://production.plaid.com'
  : PLAID_ENV === 'development'
  ? 'https://development.plaid.com'
  : 'https://sandbox.plaid.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const { action, public_token, account_id } = body;

    if (action === 'refresh') {
      const cronSecret = req.headers.get('x-cron-secret');
      const isCron = !!CRON_SECRET && cronSecret === CRON_SECRET;

      if (!isCron) {
        const authError = await requireAdmin(req, supabaseUrl, anonKey, serviceRoleKey);
        if (authError) return authError;
      }

      return await handleRefresh(adminClient);
    }

    const authError = await requireAdmin(req, supabaseUrl, anonKey, serviceRoleKey);
    if (authError) return authError;

    if (action === 'exchange' && public_token) {
      return await handleExchange(adminClient, public_token);
    }

    if (action === 'link_token') {
      return await handleLinkToken(account_id);
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    if (err instanceof PlaidError) {
      const needsRelink = err.code === 'ITEM_LOGIN_REQUIRED';
      return json(
        { error: err.message, needs_relink: needsRelink, error_code: err.code },
        needsRelink ? 401 : 400
      );
    }
    return json({ error: String(err) }, 500);
  }
});

async function requireAdmin(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string
): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Missing authorization header' }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('persona')
    .eq('id', callerData.user.id)
    .single();

  if (profileError || callerProfile?.persona !== 'admin') {
    return json({ error: 'Only admins can manage financial accounts' }, 403);
  }

  return null;
}

async function handleLinkToken(accountId: string | undefined): Promise<Response> {
  const linkRes = await plaidFetch('/link/token/create', {
    client_name: "Jeanne's Care Bridge",
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: accountId ?? 'admin' },
    products: ['transactions'],
  });
  return json({ link_token: linkRes.link_token });
}

async function handleExchange(
  supabase: SupabaseClient,
  publicToken: string
): Promise<Response> {
  const exchangeRes = await plaidFetch('/item/public_token/exchange', { public_token: publicToken });
  const { access_token, item_id } = exchangeRes;

  const accounts = await fetchAccountBalances(access_token);
  const chimeAccount = selectChimeAccount(accounts);
  const accountPayload = {
    institution: 'Chime',
    account_name: chimeAccount?.name ?? 'Spending',
    plaid_item_id: item_id,
    plaid_access_token: access_token,
    last_balance: chimeAccount?.balances?.current ?? null,
    last_synced: new Date().toISOString(),
    display_on_mother_hub: true,
  };

  const { data: existing } = await supabase
    .from('financial_accounts')
    .select('id')
    .ilike('institution', 'chime')
    .limit(1)
    .maybeSingle();

  let account;
  if (existing?.id) {
    const { data, error } = await supabase
      .from('financial_accounts')
      .update(accountPayload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    account = data;
  } else {
    const { data, error } = await supabase
      .from('financial_accounts')
      .insert(accountPayload)
      .select()
      .single();
    if (error) throw error;
    account = data;
  }

  return json({ account });
}

async function handleRefresh(supabase: SupabaseClient): Promise<Response> {
  const { data: accounts } = await supabase
    .from('financial_accounts')
    .select('*')
    .ilike('institution', 'chime')
    .limit(1);

  const chime = accounts?.[0];
  if (!chime?.plaid_access_token) {
    return json({ error: 'Chime not connected via Plaid' }, 400);
  }

  const accounts = await fetchAccountBalances(chime.plaid_access_token);
  const plaidAccount = selectChimeAccount(accounts);
  const balance = plaidAccount?.balances?.current ?? chime.last_balance;

  const { data: updated, error } = await supabase
    .from('financial_accounts')
    .update({ last_balance: balance, last_synced: new Date().toISOString() })
    .eq('id', chime.id)
    .select()
    .single();

  if (error) throw error;
  return json({ account: updated });
}

async function fetchAccountBalances(accessToken: string): Promise<PlaidAccount[]> {
  try {
    const res = await plaidFetch('/accounts/balance/get', { access_token: accessToken });
    return res.accounts ?? [];
  } catch (err) {
    // Production Items linked via Transactions may not have Balance API access;
    // /accounts/get returns cached balances included with the Transactions product.
    if (
      err instanceof PlaidError &&
      (err.code === 'INVALID_PRODUCT' || err.message.includes('not authorized to access'))
    ) {
      const res = await plaidFetch('/accounts/get', { access_token: accessToken });
      return res.accounts ?? [];
    }
    throw err;
  }
}

function selectChimeAccount(accounts: PlaidAccount[] | undefined): PlaidAccount | undefined {
  if (!accounts?.length) return undefined;
  return accounts.find((a) =>
    a.name?.toLowerCase().includes('chime') || a.subtype === 'checking'
  ) ?? accounts[0];
}

async function plaidFetch(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      ...body,
    }),
  });
  const data = await res.json();
  if (data.error_code) {
    throw new PlaidError(data.error_message ?? data.error_code, data.error_code);
  }
  return data;
}

class PlaidError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'PlaidError';
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface PlaidAccount {
  name?: string;
  subtype?: string;
  balances?: { current?: number };
}
