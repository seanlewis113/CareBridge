import { api, PlaidApiError } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { openPlaidLink } from '../../shared/plaidLink';
import { renderAdminShell } from '../shared/shell';
import { el, formatCurrency, formatDate, formatDateTime, showModal, showToast } from '../../shared/utils';
import * as XLSX from 'xlsx';
import type { FinancialAccount, Transaction } from '../../shared/types';
import { isHiddenTransaction } from '../../shared/transactionFilters';
import { buildTransactionCategoryOptions } from '../../shared/transactionCategories';

function isChimeAutoSyncEnabled(account: FinancialAccount | undefined): boolean {
  return !!account?.plaid_item_id;
}

function chimeBalanceMeta(account: FinancialAccount | undefined): string {
  if (!account?.last_synced) return 'Not synced';
  return isChimeAutoSyncEnabled(account)
    ? `Updated ${formatDateTime(account.last_synced)}`
    : `Updated ${formatDateTime(account.last_synced)} · manual`;
}

export async function renderAdminFinance(): Promise<void> {
  const content = el('div', {});

  const session = getSession();
  const [accounts, transactions] = await Promise.all([
    api.getFinancialAccounts(),
    api.getTransactions(),
  ]);
  const chimeAccount = accounts.find((a) => a.institution.toLowerCase() === 'chime');
  const chimeAutoSync = isChimeAutoSyncEnabled(chimeAccount);

  const headerActions = el('div', { style: 'display:flex;gap:0.5rem;flex-wrap:wrap' });
  if (chimeAutoSync) {
    headerActions.append(
      el('button', { className: 'btn btn-secondary', type: 'button', id: 'refresh-chime' }, 'Refresh Chime'),
      el('button', { className: 'btn btn-ghost', type: 'button', id: 'reconnect-chime' }, 'Reconnect Chime')
    );
  } else {
    headerActions.append(
      el('button', { className: 'btn btn-primary', type: 'button', id: 'connect-chime' }, 'Connect Chime'),
      el('button', { className: 'btn btn-secondary', type: 'button', id: 'set-chime-balance' },
        chimeAccount?.last_balance != null ? 'Update Chime Balance' : 'Enter Chime Balance'
      )
    );
  }
  headerActions.append(
    el('button', { className: 'btn btn-secondary', type: 'button', id: 'import-tx' }, 'Import Transactions')
  );

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem' },
      el('h2', {}, 'Financials'),
      headerActions
    )
  );

  if (!chimeAutoSync) {
    content.append(
      el('p', {
        style: 'font-size:0.9rem;color:var(--color-text-muted);margin:0 0 1rem',
      },
        'Connect Chime via Plaid for automatic balance sync, or enter the balance manually as a fallback.'
      )
    );
  } else {
    content.append(
      el('p', {
        style: 'font-size:0.9rem;color:var(--color-text-muted);margin:0 0 1rem',
      },
        chimeAccount?.last_synced
          ? `Chime is connected. Balance and transactions refresh automatically every 6 hours. Last synced ${formatDateTime(chimeAccount.last_synced)}.`
          : 'Chime is connected via Plaid. Balance and transactions will sync on the next refresh.'
      )
    );
  }

  const summary = el('div', { className: 'finance-summary' });
  for (const account of accounts) {
    const isChime = account.institution.toLowerCase() === 'chime';
    const card = el('div', { className: 'stat-card' },
      el('div', { className: 'label' }, `${account.institution} — ${account.account_name}`),
      el('div', { className: 'value' },
        account.last_balance != null ? formatCurrency(account.last_balance) : '—'
      ),
      el('p', { style: 'font-size:0.8rem;color:var(--color-text-muted);margin:0.25rem 0 0' },
        isChime ? chimeBalanceMeta(account) : (account.last_synced ? `Updated ${formatDate(account.last_synced)}` : 'Not synced')
      )
    );

    if (isChime && !isChimeAutoSyncEnabled(account)) {
      const setBalanceBtn = el('button', {
        className: 'btn btn-ghost',
        type: 'button',
        style: 'margin-top:0.5rem;padding:0.25rem 0;font-size:0.82rem',
      }, account.last_balance != null ? 'Update balance' : 'Enter balance');
      setBalanceBtn.addEventListener('click', () => {
        const form = renderChimeBalanceForm(account.last_balance, async () => {
          close();
          await renderAdminFinance();
        });
        const close = showModal('Chime Balance', form);
      });
      card.append(setBalanceBtn);
    }

    summary.append(card);
  }
  content.append(summary);

  content.append(el('h3', {}, 'Spending by Category'));
  const categoryChart = el('div', { id: 'category-chart' }, renderCategoryChart(transactions));
  content.append(categoryChart);

  content.append(el('h3', { style: 'margin-top:1.5rem' }, 'Recent Transactions'));
  const categoryOptions = buildTransactionCategoryOptions(transactions);
  const txList = el('div', { className: 'card' });
  if (transactions.length === 0) {
    txList.append(el('p', { className: 'empty-state' },
      'No transactions yet. Connect Chime via Plaid and refresh, or import an Excel or CSV export from your bank.'
    ));
  } else {
    const table = el('div', { className: 'card-table' },
      el('div', { className: 'card-table-header' },
        el('div', { className: 'card-table-row card-table-row--tx' },
          el('span', {}, 'Date'),
          el('span', {}, 'Description'),
          el('span', {}, 'Category'),
          el('span', {}, 'Amount')
        )
      ),
      el('div', { className: 'card-table-body' })
    );
    const body = table.querySelector('.card-table-body')!;
    for (const tx of transactions.slice(0, 50)) {
      body.append(
        el('div', { className: 'card-table-row card-table-row--tx' },
          el('span', { className: 'card-table-muted' }, formatDate(tx.date)),
          el('span', {},
            el('strong', {}, tx.description),
            el('span', { className: 'card-table-muted', style: 'margin-left:0.35rem' },
              tx.account?.institution ?? 'Account'
            )
          ),
          renderTransactionCategorySelect(tx, categoryOptions, () => {
            categoryChart.replaceChildren(renderCategoryChart(transactions));
          }),
          el('span', {
            style: 'font-weight:700;text-align:right;color:' + (tx.amount < 0 ? 'var(--color-danger)' : 'var(--color-success)'),
          }, formatCurrency(tx.amount))
        )
      );
    }
    txList.append(table);
  }
  content.append(txList);

  renderAdminShell(content, '/admin/finance');

  document.getElementById('connect-chime')?.addEventListener('click', () => {
    void startPlaidConnect(async () => {
      await renderAdminFinance();
    });
  });

  document.getElementById('reconnect-chime')?.addEventListener('click', () => {
    void startPlaidConnect(async () => {
      await renderAdminFinance();
    });
  });

  document.getElementById('refresh-chime')?.addEventListener('click', async () => {
    const btn = document.getElementById('refresh-chime') as HTMLButtonElement;
    btn.disabled = true;
    try {
      const { transactionsSynced } = await api.refreshChimeBalance();
      const txTotal = transactionsSynced
        ? transactionsSynced.added + transactionsSynced.modified + transactionsSynced.removed
        : 0;
      showToast(
        txTotal > 0
          ? `Chime updated (${transactionsSynced!.added} new transactions)`
          : 'Chime balance updated'
      );
      await renderAdminFinance();
    } catch (err) {
      if (err instanceof PlaidApiError && err.needsRelink) {
        alert('Chime login expired. Click "Reconnect Chime" to sign in again.');
      } else {
        alert(err instanceof Error ? err.message : 'Could not refresh Chime balance.');
      }
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('set-chime-balance')?.addEventListener('click', () => {
    const form = renderChimeBalanceForm(chimeAccount?.last_balance ?? null, async () => {
      close();
      await renderAdminFinance();
    });
    const close = showModal('Chime Balance', form);
  });

  document.getElementById('import-tx')?.addEventListener('click', () => {
    const form = renderImportForm(accounts, session.profile?.id ?? null, async () => {
      close();
      await renderAdminFinance();
    });
    const close = showModal('Import Transactions', form);
  });
}

function renderCategoryChart(transactions: Transaction[]): HTMLElement {
  const expenses = transactions.filter((t) => t.amount < 0);
  const byCategory = new Map<string, number>();
  for (const tx of expenses) {
    const cat = tx.category ?? 'Uncategorized';
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + Math.abs(tx.amount));
  }

  if (byCategory.size === 0) {
    return el('p', { className: 'empty-state' }, 'Import transactions to see spending breakdown.');
  }

  const max = Math.max(...byCategory.values());
  const container = el('div', { className: 'chart-bar-container card' });

  for (const [cat, amount] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = max > 0 ? (amount / max) * 100 : 0;
    container.append(
      el('div', { className: 'chart-bar-row' },
        el('span', { className: 'chart-bar-label' }, cat),
        el('div', { className: 'chart-bar-track' },
          el('div', { className: 'chart-bar-fill', style: `width:${pct}%` })
        ),
        el('span', { className: 'chart-bar-value' }, formatCurrency(-amount))
      )
    );
  }

  return container;
}

function renderTransactionCategorySelect(
  tx: Transaction,
  categoryOptions: string[],
  onUpdated: () => void
): HTMLElement {
  const select = el('select', {
    className: 'tx-category-select',
    'aria-label': `Category for ${tx.description}`,
  },
    el('option', { value: '' }, 'Uncategorized'),
    ...categoryOptions.map((category) => el('option', { value: category }, category))
  );
  select.value = tx.category ?? '';

  select.addEventListener('change', async () => {
    const previous = tx.category;
    const category = select.value || null;
    select.disabled = true;
    try {
      await api.updateTransaction(tx.id, { category, category_override: true });
      tx.category = category;
      onUpdated();
    } catch (err) {
      select.value = previous ?? '';
      showToast(err instanceof Error ? err.message : 'Could not update category');
    } finally {
      select.disabled = false;
    }
  });

  return select;
}

function renderChimeBalanceForm(currentBalance: number | null, onSuccess: () => void): HTMLElement {
  const form = el('form', { className: 'modal-body' });
  const initialValue = currentBalance != null ? currentBalance.toFixed(2) : '';

  form.append(
    el('p', { style: 'font-size:0.9rem;color:var(--color-text-muted);margin:0 0 1rem' },
      'Enter the current Chime balance. It will show on Mom\'s hub until auto-sync is connected.'
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'chime-balance' }, 'Current balance'),
      el('input', {
        type: 'number',
        id: 'chime-balance',
        name: 'chime-balance',
        required: 'true',
        min: '0',
        step: '0.01',
        inputmode: 'decimal',
        placeholder: '0.00',
        value: initialValue,
      })
    ),
    el('p', { id: 'chime-balance-status', style: 'font-size:0.85rem;color:var(--color-text-muted)' }),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, 'Save Balance')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('#chime-balance-status') as HTMLElement;
    const raw = (form.querySelector('#chime-balance') as HTMLInputElement).value.trim();
    const balance = parseFloat(raw);

    if (!Number.isFinite(balance) || balance < 0) {
      status.textContent = 'Enter a valid balance of zero or more.';
      status.style.color = 'var(--color-danger)';
      return;
    }

    status.textContent = 'Saving...';
    status.style.color = 'var(--color-text-muted)';

    try {
      await api.setChimeBalance(balance);
      onSuccess();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Could not save balance';
      status.style.color = 'var(--color-danger)';
    }
  });

  return form;
}

async function startPlaidConnect(onSuccess: () => void | Promise<void>): Promise<void> {
  try {
    const linkToken = await api.getPlaidLinkToken();
    await openPlaidLink({
      token: linkToken,
      onSuccess: async (publicToken) => {
        try {
          await api.exchangePlaidToken(publicToken);
          showToast('Chime connected — syncing transactions');
          await onSuccess();
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Could not connect Chime account.');
        }
      },
      onExit: (error) => {
        if (error?.display_message || error?.error_message) {
          showToast(error.display_message ?? error.error_message ?? 'Plaid Link closed');
        }
      },
    });
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not start Plaid Link.');
  }
}

function renderImportForm(
  accounts: FinancialAccount[],
  profileId: string | null,
  onSuccess: () => void
): HTMLElement {
  const form = el('form', { className: 'modal-body' });

  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'import-account' }, 'Account'),
      el('select', { id: 'import-account', required: 'true' },
        ...accounts.map((a) => el('option', { value: a.id }, `${a.institution} — ${a.account_name}`))
      )
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'import-file' }, 'Excel or CSV file'),
      el('input', { type: 'file', id: 'import-file', accept: '.xlsx,.xls,.csv', required: 'true' })
    ),
    el('div', { className: 'form-group' },
      el('label', { for: 'import-source' }, 'Institution template'),
      el('select', { id: 'import-source' },
        el('option', { value: 'auto' }, 'Auto-detect columns'),
        el('option', { value: 'wells_fargo' }, 'Wells Fargo'),
        el('option', { value: 'chime' }, 'Chime'),
        el('option', { value: 'generic' }, 'Generic (Date, Description, Amount)')
      )
    ),
    el('p', { id: 'import-status', style: 'font-size:0.85rem;color:var(--color-text-muted)' }),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, 'Import')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('#import-status') as HTMLElement;
    const file = (form.querySelector('#import-file') as HTMLInputElement).files?.[0];
    const accountId = (form.querySelector('#import-account') as HTMLSelectElement).value;
    const source = (form.querySelector('#import-source') as HTMLSelectElement).value;

    if (!file) return;
    status.textContent = 'Parsing file...';

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

      const transactions = parseTransactionRows(rows, accountId, source, file.name);
      const count = await api.importTransactions(transactions);
      await api.logFinancialAccess(profileId, `imported ${count} transactions from ${file.name}`);
      status.textContent = `Imported ${count} transactions.`;
      onSuccess();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Import failed';
      status.style.color = 'var(--color-danger)';
    }
  });

  return form;
}

function parseTransactionRows(
  rows: Record<string, unknown>[],
  accountId: string,
  source: string,
  fileName: string
): Omit<Transaction, 'id' | 'created_at' | 'account'>[] {
  const results: Omit<Transaction, 'id' | 'created_at' | 'account'>[] = [];

  for (const row of rows) {
    const keys = Object.keys(row);
    const dateKey = findKey(keys, source === 'wells_fargo' ? ['date', 'transaction date', 'posted date'] : ['date', 'transaction date', 'posted date', 'posting date']);
    const descKey = findKey(keys, source === 'chime' ? ['description', 'memo', 'name'] : ['description', 'memo', 'payee', 'name']);
    const amountKey = findKey(keys, ['amount', 'debit', 'credit', 'transaction amount']);

    if (!dateKey || !descKey) continue;

    let amount = 0;
    if (amountKey) {
      amount = parseAmount(row[amountKey]);
    } else {
      const debit = findKey(keys, ['debit', 'withdrawal']);
      const credit = findKey(keys, ['credit', 'deposit']);
      if (debit && row[debit]) amount = -Math.abs(parseAmount(row[debit]));
      else if (credit && row[credit]) amount = Math.abs(parseAmount(row[credit]));
    }

    const dateVal = parseDate(row[dateKey]);
    if (!dateVal) continue;

    const description = String(row[descKey] ?? 'Transaction');
    if (isHiddenTransaction({ description })) continue;

    results.push({
      account_id: accountId,
      date: dateVal,
      description,
      amount,
      category: guessCategory(String(row[descKey] ?? '')),
      import_source: `${source}:${fileName}`,
    });
  }

  return results;
}

function findKey(keys: string[], candidates: string[]): string | undefined {
  const lower = keys.map((k) => k.toLowerCase());
  for (const c of candidates) {
    const idx = lower.findIndex((k) => k.includes(c));
    if (idx >= 0) return keys[idx];
  }
  return keys[0];
}

function parseAmount(val: unknown): number {
  if (typeof val === 'number') return val;
  const str = String(val).replace(/[$,]/g, '');
  return parseFloat(str) || 0;
}

function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    const date = XLSX.SSF.parse_date_code(val);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
  }
  const d = new Date(String(val));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function guessCategory(description: string): string {
  const d = description.toLowerCase();
  if (d.includes('grocery') || d.includes('safeway') || d.includes('walmart') || d.includes('costco')) return 'Groceries';
  if (d.includes('pharmacy') || d.includes('cvs') || d.includes('walgreens')) return 'Medical';
  if (d.includes('gas') || d.includes('shell') || d.includes('chevron')) return 'Transportation';
  if (d.includes('restaurant') || d.includes('cafe') || d.includes('starbucks')) return 'Dining';
  if (d.includes('electric') || d.includes('water') || d.includes('utility')) return 'Utilities';
  return 'Other';
}
