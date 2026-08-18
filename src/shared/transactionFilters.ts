/** Chime internal secured-card autopay — not real income; hide from finance views. */
export function isHiddenTransaction(tx: { description: string }): boolean {
  return tx.description.toLowerCase().includes('card payment from secured account');
}

/** Sean's Wells Fargo → Chime funding transfers — hide on mother's transaction list. */
export function isMotherHubHiddenTransaction(tx: { description: string }): boolean {
  return tx.description.toLowerCase().includes('transfer from wells fargo');
}
