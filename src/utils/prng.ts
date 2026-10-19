/**
 * Générateur pseudo-aléatoire déterministe basé sur Mulberry32 (32 bits).
 *
 * Aucune source d'entropie externe (Math.random, crypto, Date) n'est utilisée :
 * le déterminisme du tournoi est garanti par la graine initiale et l'index de
 * séquence.
 */
export class DeterministicPRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Exécute un pas Mulberry32 et retourne un réel dans [0, 1[. */
  nextFloat(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Retourne un entier déterministe dans [min, maxInclusive]. */
  nextInt(min: number, maxInclusive: number): number {
    if (maxInclusive < min) {
      throw new RangeError(`nextInt: maxInclusive (${maxInclusive}) < min (${min})`);
    }
    const span = maxInclusive - min + 1;
    return min + Math.floor(this.nextFloat() * span);
  }

  /** Fisher-Yates. Retourne une nouvelle copie mélangée sans muter l'entrée. */
  shuffle<T>(array: readonly T[]): T[] {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
