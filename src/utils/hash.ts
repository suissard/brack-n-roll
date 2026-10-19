/**
 * Hachage déterministe d'état par FNV-1a 32 bits.
 *
 * La sérialisation est "canonique" : les clés d'objets sont triées
 * alphabétiquement, ce qui rend le hash indépendant de l'ordre d'insertion.
 */
export class StateHasher {
  private static readonly OFFSET_BASIS = 2166136261;
  private static readonly PRIME = 16777619;

  /** Sérialise canoniquement `data` puis calcule l'empreinte hexadécimale 32 bits. */
  static computeHash(data: unknown): string {
    const canonical = StateHasher.canonicalize(data);
    let hash = StateHasher.OFFSET_BASIS >>> 0;
    for (let i = 0; i < canonical.length; i++) {
      hash ^= canonical.charCodeAt(i);
      hash = Math.imul(hash, StateHasher.PRIME) >>> 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private static canonicalize(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    const type = typeof value;
    if (type === 'number') {
      return Number.isFinite(value as number) ? String(value) : 'null';
    }
    if (type === 'boolean') return (value as boolean) ? 'true' : 'false';
    if (type === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((v) => StateHasher.canonicalize(v)).join(',')}]`;
    }
    if (type === 'object') {
      if (value instanceof Map) {
        const entries = [...value.entries()].map(
          ([k, v]) => [String(k), v] as const,
        );
        entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${StateHasher.canonicalize(v)}`).join(',')}}`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys
        .map((k) => `${JSON.stringify(k)}:${StateHasher.canonicalize(record[k])}`)
        .join(',')}}`;
    }
    return 'null';
  }
}
