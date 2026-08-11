import { api } from '../../shared/api';
import { canAccessFinancials, unlockFinancials, lockFinancials, getSession } from '../../shared/auth';
import { renderAdminShell } from '../shared/shell';
import { el, formatCurrency, formatDate, showModal } from '../../shared/utils';
import * as XLSX from 'xlsx';
import type { FinancialAccount, Transaction } from '../../shared/types';

export async function renderAdminFinance(): Promise<void> {
  const content = el('div', {});

  if (!canAccessFinancials()) {
    content.append(
      el('div', { className: 'finance-locked card' },
        el('h2', {}, 'Financials'),
        el('p', {}, 'Enter your financial PIN to view accounts and spending.'),
        renderPinForm(async () => renderAdminFinance())
      )
    );
    renderAdminShell(content, '/admin/finance');
    return;
  }

  const session = getSession();
  const [accounts, transactions] = await Promise.all([
    api.getFinancialAccounts(),
    api.getTransactions(),
  ]);

  content.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem' },
      el('h2', {}, 'Financials'),
      el('div', { style: 'display:flex;gap:0.5rem' },
        el('button', { className: 'btn btn-secondary', type: 'button', id: 'refresh-chime' }, 'Refresh Chime'),
        el('button', { className: 'btn btn-secondary', type: 'button', id: 'import-tx' }, 'Import Transactions'),
        el('button', { className: 'btn btn-secondary', type: 'button', id: 'lock-finance' }, 'Lock')
      )
    )
  );

  const summary = el('div', { className: 'finance-summary' });
  for (const account of accounts) {
    summary.append(
      el('div', { className: 'stat-card' },
        el('div', { className: 'label' }, `${account.institution} — ${account.account_name}`),
        el('div', { className: 'value' },
          account.last_balance != null ? formatCurrency(account.last_balance) : '—'
        ),
        el('p', { style: 'font-size:0.8rem;color:var(--color-text-muted);margin:0.25rem 0 0' },
          account.last_synced ? `Updated ${formatDate(account.last_synced)}` : 'Not synced'
        )
      )
    );
  }
  content.append(summary);

  content.append(el('h3', {}, 'Spending by Category'));
  content.append(renderCategoryChart(transactions));

  content.append(el('h3', { style: 'margin-top:1.5rem' }, 'Recent Transactions'));
  const txList = el('div', { className: 'card' });
  if (transactions.length === 0) {
    txList.append(el('p', { className: 'empty-state' }, 'No transactions yet. Import an Excel or CSV export from your bank.'));
  } else {
    for (const tx of transactions.slice(0, 50)) {
      txList.append(
        el('div', { className: 'list-item' },
          el('div', {},
            el('strong', {}, tx.description),
            el('div', { style: 'font-size:0.85rem;color:var(--color-text-muted)' },
              `${formatDate(tx.date)} · ${tx.account?.institution ?? 'Account'} · ${tx.category ?? 'Uncategorized'}`
            )
          ),
          el('div', { style: 'font-weight:700;color:' + (tx.amount < 0 ? 'var(--color-danger)' : 'var(--color-success)') },
            formatCurrency(tx.amount)
          )
        )
      );
    }
  }
  content.append(txList);

  renderAdminShell(content, '/admin/finance');

  document.getElementById('lock-finance')?.addEventListener('click', () => {
    lockFinancials();
    renderAdminFinance();
  });

  document.getElementById('refresh-chime')?.addEventListener('click', async () => {
    try {
      await api.refreshChimeBalance();
      await renderAdminFinance();
    } catch {
      alert('Chime refresh requires Plaid configuration. Balance shown is from last manual update.');
    }
  });

  document.getElementById('import-tx')?.addEventListener('click', () => {
    const form = renderImportForm(accounts, session.profile?.id ?? null, async () => {
      close();
      await renderAdminFinance();
    });
    const close = showModal('Import Transactions', form);
  });
}

function renderPinForm(onSuccess: () => void): HTMLElement {
  const form = el('form', { style: 'max-width:280px;margin:1rem auto' });
  form.append(
    el('div', { className: 'form-group' },
      el('label', { for: 'fin-pin' }, 'Financial PIN'),
      el('input', { type: 'password', id: 'fin-pin', className: 'pin-input', inputmode: 'numeric', required: 'true' })
    ),
    el('p', { id: 'fin-pin-error', style: 'color:var(--color-danger);display:none' }),
    el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, 'Unlock')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = (form.querySelector('#fin-pin') as HTMLInputElement).value;
    const ok = await unlockFinancials(pin);
    if (ok) onSuccess();
    else {
      const err = form.querySelector('#fin-pin-error') as HTMLElement;
      err.textContent = 'Incorrect PIN';
      err.style.display = 'block';
    }
  });

  return form;
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

    results.push({
      account_id: accountId,
      date: dateVal,
      description: String(row[descKey] ?? 'Transaction'),
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
