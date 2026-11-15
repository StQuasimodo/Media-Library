/** Bounded renderer-session navigation state; no credentials or film records. */
export interface BrowseSnapshot { scrollTop: number; focusKey?: string; values: Record<string, unknown>; }
export class BrowseMemory {
  private entries = new Map<string, BrowseSnapshot>();
  constructor(private readonly limit = 40) {}
  read(key: string) { return this.entries.get(key); }
  remember(key: string, patch: Partial<BrowseSnapshot>) {
    const previous = this.entries.get(key) ?? { scrollTop: 0, values: {} };
    this.entries.delete(key); this.entries.set(key, { ...previous, ...patch });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
  value(key: string, name: string, value: unknown) { this.remember(key, { values: { ...this.read(key)?.values, [name]: value } }); }
}
export const browseMemory = new BrowseMemory();
