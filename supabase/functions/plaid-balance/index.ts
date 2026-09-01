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
    const body = await safeJson(req);
    const actionFromBody = typeof body.action === 'string' ? body.action : undefined;
    const actionFromQuery = new URL(req.url).searchParams.get('action') ?? undefined;
    const action = actionFromBody ?? actionFromQuery;
    const publicToken = typeof body.public_token === 'string' ? body.public_token : undefined;
    const accountId = typeof body.account_id === 'string' ? body.account_id : undefined;
    const cronSecret = req.headers.get('x-cron-secret');
    const isCron = !!CRON_SECRET && cronSecret === CRON_SECRET;
    const shouldRefresh = action === 'refresh' || (isCron && !action);

    if (shouldRefresh) {

      if (!isCron) {
        const authError = await requireAdmin(req, supabaseUrl, anonKey, serviceRoleKey);
        if (authError) return authError;
      }

      return await handleRefresh(adminClient);
    }

    const authError = await requireAdmin(req, supabaseUrl, anonKey, serviceRoleKey);
    if (authError) return authError;

    if (action === 'exchange' && publicToken) {
      return await handleExchange(adminClient, publicToken);
    }

    if (action === 'link_token') {
      return await handleLinkToken(accountId);
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
    plaid_account_id: chimeAccount?.account_id ?? null,
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

  const resetCursor = { plaid_transactions_cursor: null };

  let account;
  if (existing?.id) {
    const { data, error } = await supabase
      .from('financial_accounts')
      .update({ ...accountPayload, ...resetCursor })
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

  const txSync = await syncTransactions(
    supabase,
    account.id,
    access_token,
    null,
    chimeAccount?.account_id
  );

  const { data: syncedAccount, error: syncError } = await supabase
    .from('financial_accounts')
    .update({
      plaid_transactions_cursor: txSync.cursor,
      plaid_account_id: chimeAccount?.account_id ?? null,
    })
    .eq('id', account.id)
    .select()
    .single();
  if (syncError) throw syncError;

  return json({ account: syncedAccount, transactions_synced: txSync.counts });
}

async function handleRefresh(supabase: SupabaseClient): Promise<Response> {
  const { data: storedAccounts } = await supabase
    .from('financial_accounts')
    .select('*')
    .ilike('institution', 'chime')
    .limit(1);

  const chime = storedAccounts?.[0];
  if (!chime?.plaid_access_token) {
    return json({ error: 'Chime not connected via Plaid' }, 400);
  }

  const plaidAccounts = await fetchAccountBalances(chime.plaid_access_token);
  const plaidAccount = selectChimeAccount(plaidAccounts, chime.plaid_account_id);
  const balance = plaidAccount?.balances?.current ?? chime.last_balance;
  const plaidAccountId = plaidAccount?.account_id ?? chime.plaid_account_id ?? undefined;

  let txSync = await syncTransactions(
    supabase,
    chime.id,
    chime.plaid_access_token,
    normalizePlaidCursor(chime.plaid_transactions_cursor),
    plaidAccountId
  );

  const hadCursor = !!normalizePlaidCursor(chime.plaid_transactions_cursor);
  if (hadCursor && txSync.counts.added === 0 && txSync.counts.modified === 0) {
    const stale = await isTransactionSyncStale(supabase, chime.id);
    if (stale) {
      txSync = await syncTransactions(
        supabase,
        chime.id,
        chime.plaid_access_token,
        null,
        plaidAccountId
      );
      txSync.counts.resynced = true;
    }
  }

  const { data: updated, error } = await supabase
    .from('financial_accounts')
    .update({
      last_balance: balance,
      last_synced: new Date().toISOString(),
      plaid_account_id: plaidAccountId ?? chime.plaid_account_id,
      plaid_transactions_cursor: txSync.cursor,
    })
    .eq('id', chime.id)
    .select()
    .single();

  if (error) throw error;
  return json({ account: updated, transactions_synced: txSync.counts });
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

function selectChimeAccount(
  accounts: PlaidAccount[] | undefined,
  storedAccountId?: string | null
): PlaidAccount | undefined {
  if (!accounts?.length) return undefined;

  if (storedAccountId) {
    const stored = accounts.find((a) => a.account_id === storedAccountId);
    if (stored) return stored;
  }

  const spending = accounts.find((a) => {
    const name = a.name?.toLowerCase() ?? '';
    return name.includes('spending') ||
      (name.includes('checking') && !name.includes('credit') && !name.includes('builder'));
  });
  if (spending) return spending;

  return accounts.find((a) =>
    a.name?.toLowerCase().includes('chime') || a.subtype === 'checking'
  ) ?? accounts[0];
}

async function isTransactionSyncStale(
  supabase: SupabaseClient,
  accountId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('transactions')
    .select('date')
    .eq('account_id', accountId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.date) return false;

  const latest = new Date(`${data.date}T12:00:00Z`).getTime();
  const daysSince = (Date.now() - latest) / (1000 * 60 * 60 * 24);
  return daysSince > 7;
}

interface TransactionSyncCounts {
  added: number;
  modified: number;
  removed: number;
  upgraded?: number;
  resynced?: boolean;
}

function normalizePlaidCursor(cursor: string | null | undefined): string | null {
  if (!cursor) return null;
  const trimmed = cursor.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function safeJson(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return {};
  }
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function transactionBusinessKey(
  date: string,
  description: string,
  amount: number
): string {
  const normalizedAmount = Number(amount).toFixed(2);
  return `${date}|${description.trim().toLowerCase()}|${normalizedAmount}`;
}

async function syncTransactions(
  supabase: SupabaseClient,
  accountId: string,
  accessToken: string,
  cursor: string | null,
  plaidAccountId: string | undefined
): Promise<{ cursor: string | null; counts: TransactionSyncCounts }> {
  const counts: TransactionSyncCounts = { added: 0, modified: 0, removed: 0 };
  let nextCursor = normalizePlaidCursor(cursor) ?? '';
  let hasMore = true;

  const pendingAdded: PlaidTransaction[] = [];
  const pendingModified: PlaidTransaction[] = [];
  const pendingRemoved: string[] = [];

  while (hasMore) {
    const body: Record<string, unknown> = { access_token: accessToken };
    if (nextCursor) body.cursor = nextCursor;

    const res = await plaidFetch('/transactions/sync', body);
    hasMore = res.has_more ?? false;
    nextCursor = res.next_cursor ?? nextCursor;

    for (const tx of (res.added ?? []) as PlaidTransaction[]) {
      if (plaidAccountId && tx.account_id !== plaidAccountId) continue;
      if (isHiddenPlaidTransaction(tx)) continue;
      pendingAdded.push(tx);
    }
    for (const tx of (res.modified ?? []) as PlaidTransaction[]) {
      if (plaidAccountId && tx.account_id !== plaidAccountId) continue;
      if (isHiddenPlaidTransaction(tx)) continue;
      pendingModified.push(tx);
    }
    for (const id of (res.removed ?? []) as { transaction_id?: string }[]) {
      if (id.transaction_id) pendingRemoved.push(id.transaction_id);
    }
  }

  await removeHiddenTransactions(supabase, accountId);

  if (pendingAdded.length > 0) {
    const plaidSources = pendingAdded.map((tx) => plaidImportSource(tx.transaction_id));
    const { data: existingBySource, error: existingBySourceError } = await supabase
      .from('transactions')
      .select('import_source')
      .eq('account_id', accountId)
      .in('import_source', plaidSources);
    if (existingBySourceError) throw existingBySourceError;

    const knownSources = new Set((existingBySource ?? []).map((row) => row.import_source));
    const candidateRows = pendingAdded
      .filter((tx) => !knownSources.has(plaidImportSource(tx.transaction_id)))
      .map((tx) => mapPlaidTransaction(tx, accountId));

    const candidateDates = [...new Set(candidateRows.map((row) => row.date))];
    const { data: existingByKey, error: existingByKeyError } = candidateDates.length > 0
      ? await supabase
        .from('transactions')
        .select('id, date, description, amount, import_source, category_override')
        .eq('account_id', accountId)
        .in('date', candidateDates)
      : { data: [], error: null };
    if (existingByKeyError) throw existingByKeyError;

    const existingByBusinessKey = new Map<string, {
      id: string;
      import_source: string;
      category_override: boolean | null;
    }>();
    for (const row of existingByKey ?? []) {
      const key = transactionBusinessKey(row.date, row.description, Number(row.amount));
      if (!existingByBusinessKey.has(key)) {
        existingByBusinessKey.set(key, {
          id: row.id,
          import_source: row.import_source,
          category_override: row.category_override,
        });
      }
    }

    const toInsert: ReturnType<typeof mapPlaidTransaction>[] = [];
    for (const row of candidateRows) {
      const key = transactionBusinessKey(row.date, row.description, row.amount);
      const existing = existingByBusinessKey.get(key);

      if (!existing) {
        toInsert.push(row);
        continue;
      }

      if (existing.import_source === row.import_source) {
        continue;
      }

      if (existing.import_source.startsWith('plaid:')) {
        const { error: deleteError } = await supabase
          .from('transactions')
          .delete()
          .eq('id', existing.id);
        if (deleteError) throw deleteError;
        toInsert.push(row);
        continue;
      }

      const upgradePayload = existing.category_override
        ? { import_source: row.import_source }
        : { import_source: row.import_source, category: row.category };
      const { error: upgradeError } = await supabase
        .from('transactions')
        .update(upgradePayload)
        .eq('id', existing.id);
      if (upgradeError) throw upgradeError;
      counts.upgraded = (counts.upgraded ?? 0) + 1;
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from('transactions').insert(toInsert);
      if (error) throw error;
      counts.added = toInsert.length;
    }
  }

  if (pendingModified.length > 0) {
    const sources = pendingModified.map((tx) => plaidImportSource(tx.transaction_id));
    const { data: existingRows } = await supabase
      .from('transactions')
      .select('import_source, category_override')
      .eq('account_id', accountId)
      .in('import_source', sources);

    const overrideBySource = new Map(
      (existingRows ?? []).map((row) => [row.import_source, row.category_override === true])
    );

    for (const tx of pendingModified) {
      const source = plaidImportSource(tx.transaction_id);
      const mapped = mapPlaidTransaction(tx, accountId);
      const payload = overrideBySource.get(source)
        ? (({ category: _category, ...rest }) => rest)(mapped)
        : mapped;

      const { error } = await supabase
        .from('transactions')
        .update(payload)
        .eq('account_id', accountId)
        .eq('import_source', source);
      if (error) throw error;
      counts.modified += 1;
    }
  }

  if (pendingRemoved.length > 0) {
    const sources = pendingRemoved.map(plaidImportSource);
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('account_id', accountId)
      .in('import_source', sources);
    if (error) throw error;
    counts.removed = pendingRemoved.length;
  }

  return { cursor: normalizePlaidCursor(nextCursor), counts };
}

function plaidImportSource(transactionId: string): string {
  return `plaid:${transactionId}`;
}

const HIDDEN_TX_PATTERN = 'card payment from secured account';

function isHiddenPlaidTransaction(tx: PlaidTransaction): boolean {
  const text = [tx.merchant_name, tx.name, tx.original_description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return text.includes(HIDDEN_TX_PATTERN);
}

async function removeHiddenTransactions(supabase: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('account_id', accountId)
    .ilike('description', `%${HIDDEN_TX_PATTERN}%`);
  if (error) throw error;
}

function mapPlaidTransaction(
  tx: PlaidTransaction,
  accountId: string
): {
  account_id: string;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  import_source: string;
} {
  return {
    account_id: accountId,
    date: tx.date ?? tx.authorized_date ?? new Date().toISOString().slice(0, 10),
    description: tx.merchant_name ?? tx.name ?? 'Transaction',
    amount: -(tx.amount ?? 0),
    category: formatPlaidCategory(tx),
    import_source: plaidImportSource(tx.transaction_id),
  };
}

function formatPlaidCategory(tx: PlaidTransaction): string | null {
  const primary = tx.personal_finance_category?.primary;
  if (primary) {
    return primary
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (tx.category?.length) return tx.category.join(', ');
  return null;
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
  account_id?: string;
  name?: string;
  subtype?: string;
  balances?: { current?: number };
}

interface PlaidTransaction {
  transaction_id: string;
  account_id?: string;
  amount?: number;
  date?: string;
  authorized_date?: string;
  name?: string;
  merchant_name?: string;
  original_description?: string;
  category?: string[];
  personal_finance_category?: { primary?: string };
}
