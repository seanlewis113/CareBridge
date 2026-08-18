/** Chime internal secured-card autopay — not real income; hide from finance views. */
export function isHiddenTransaction(tx: { description: string }): boolean {
  return tx.description.toLowerCase().includes('card payment from secured account');
}
