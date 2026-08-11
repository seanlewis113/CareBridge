import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID') ?? '';
const PLAID_SECRET = Deno.env.get('PLAID_SECRET') ?? '';
const PLAID_ENV = Deno.env.get('PLAID_ENV') ?? 'sandbox';
const PLAID_BASE = PLAID_ENV === 'production'
  ? 'https://production.plaid.com'
  : PLAID_ENV === 'development'
  ? 'https://development.plaid.com'
  : 'https://sandbox.plaid.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, public_token, account_id } = await req.json();

    if (action === 'exchange' && public_token) {
      const exchangeRes = await plaidFetch('/item/public_token/exchange', { public_token });
      const { access_token, item_id } = exchangeRes;

      const balanceRes = await plaidFetch('/accounts/balance/get', { access_token });
      const chimeAccount = balanceRes.accounts?.find((a: PlaidAccount) =>
        a.name?.toLowerCase().includes('chime') || a.subtype === 'checking'
      ) ?? balanceRes.accounts?.[0];

      const { data: account } = await supabase
        .from('financial_accounts')
        .upsert({
          institution: 'Chime',
          account_name: chimeAccount?.name ?? 'Spending',
          plaid_item_id: item_id,
          plaid_access_token: access_token,
          last_balance: chimeAccount?.balances?.current ?? null,
          last_synced: new Date().toISOString(),
          display_on_mother_hub: true,
        })
        .select()
        .single();

      return json({ account });
    }

    if (action === 'refresh') {
      const { data: accounts } = await supabase
        .from('financial_accounts')
        .select('*')
        .eq('institution', 'Chime')
        .limit(1);

      const chime = accounts?.[0];
      if (!chime?.plaid_access_token) {
        return json({ error: 'Chime not connected via Plaid' }, 400);
      }

      const balanceRes = await plaidFetch('/accounts/balance/get', {
        access_token: chime.plaid_access_token,
      });
      const plaidAccount = balanceRes.accounts?.[0];
      const balance = plaidAccount?.balances?.current ?? chime.last_balance;

      const { data: updated } = await supabase
        .from('financial_accounts')
        .update({ last_balance: balance, last_synced: new Date().toISOString() })
        .eq('id', chime.id)
        .select()
        .single();

      return json({ account: updated });
    }

    if (action === 'link_token') {
      const linkRes = await plaidFetch('/link/token/create', {
        client_name: "Mom's Care",
        language: 'en',
        country_codes: ['US'],
        user: { client_user_id: account_id ?? 'admin' },
        products: ['transactions'],
      });
      return json({ link_token: linkRes.link_token });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

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
  return res.json();
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

interface PlaidAccount {
  name?: string;
  subtype?: string;
  balances?: { current?: number };
}
