import type { Transaction } from './types';

export const DEFAULT_TRANSACTION_CATEGORIES = [
  'Dining',
  'Food And Drink',
  'General Merchandise',
  'Groceries',
  'Medical',
  'Other',
  'Transfer In',
  'Transfer Out',
  'Transportation',
  'Utilities',
] as const;

export function buildTransactionCategoryOptions(transactions: Transaction[]): string[] {
  const categories = new Set<string>(DEFAULT_TRANSACTION_CATEGORIES);
  for (const tx of transactions) {
    if (tx.category) categories.add(tx.category);
  }
  return [...categories].sort((a, b) => a.localeCompare(b));
}
