# Spécification Technique d'Implémentation (V3.0 - AI Coding Agent Blueprint)
## Moteur Algorithmique de Tournoi Modulaire (DAG) & Time Machine (Event Sourcing)

> **Instructions pour l'Agent IA de Codage :**  
> Ce document est une spécification de conception détaillée (Low-Level Design). Tu dois implémenter l'intégralité de cette librairie en **TypeScript strict (Node.js)**, sans aucune dépendance externe d'exécution (`zero-dependency`), en respectant **strictement** les interfaces, les signatures de classes, les machines à états et les algorithmes décrits ci-dessous.

---

## 1. Directives Système, Contraintes & Structure du Projet

### 1.1. Contraintes Techniques Impératives
1. **Langage & Typage :** TypeScript $5.x$ avec `"strict": true`, `"noImplicitAny": true`, `"exactOptionalPropertyTypes": false`. Aucun usage de `any` n'est toléré.
2. **Zéro Dépendance Externe :** Tout le code (y compris le générateur pseudo-aléatoire `PRNG`, le clonage profond, le hachage d'état et le backtracking) doit être écrit en TypeScript natif.
3. **Déterminisme Absolu :** L'usage de `Math.random()`, `crypto.randomUUID()` ou `Date.now()` dans la logique de résolution algorithmique est **strictement interdit**. Toute génération d'identifiant ou mélange aléatoire doit découler de l'index de séquence ou de la classe `DeterministicPRNG`.
4. **Sérialisation $100\%$ JSON :** Aucune fonction JavaScript (`Function`) ne doit être stockée dans la configuration d'un bloc ou d'un connecteur. Les filtres et conditions de court-circuit utilisent un **DSL Déclaratif JSON** (`FilterRuleDSL`, `SkipConditionDSL`).
5. **Clé Sémantique Nominative :** Les événements de résultats de matchs stockent les scores par `teamId` et le couple d'équipes attendu afin que le *Causal Replay* de la Time Machine survive à un changement de numéro de table ou une inversion Domicile/Extérieur.

### 1.2. Arborescence des Fichiers à Générer
```text
src/
├── types/
│   ├── domain.types.ts        # Équipes, Stats, Matchs, Slots, Blocs, Connecteurs, DSL
│   └── events.types.ts        # Événements, Timeline, Snapshots, RebaseResult
├── utils/
│   ├── prng.ts                # DeterministicPRNG (Mulberry32)
│   ├── hash.ts                # Fonction de hachage FNV-1a déterministe pour stateHash
│   └── standings.ts           # StandingsCalculator (Tri multi-critères & Tie-breakers)
├── core/
│   ├── registry.ts            # TournamentRegistry (État central des équipes & Buchholz)
│   ├── connector.ts           # Connector (Filtrage DSL, SeedingTransform, StatsReset)
│   └── time-machine.ts        # TimeMachine (Event Log, LRU Snapshots, Causal Replay)
├── blocks/
│   ├── abstract-block.ts      # AbstractTournamentBlock (Machine à états commune)
│   ├── bracket-block.ts       # BracketRoundBlock (Single/Double Elim, Streaming, Byes)
│   ├── swiss-block.ts         # SwissRoundBlock (Monrad + Backtracking, Freeze Pairings)
│   ├── round-robin-block.ts   # RoundRobinBlock & RoundRobinStageMacro (Algorithme de Berger)
│   └── merger-block.ts        # MergerBlock (Fusion de poules & Cross-seeding)
├── engine/
│   └── tournament-graph.ts    # TournamentGraph (Façade principale & Orchestrateur DAG)
└── index.ts                   # Exports publics de la librairie
```

---

## 2. Contrats de Données et Types (`src/types/`)

### 2.1. Fichier `src/types/domain.types.ts`

```typescript
export type TeamStatus = 'ACTIVE' | 'ELIMINATED' | 'DROPPED' | 'CHAMPION';
export type MatchOutcome = 'WIN' | 'LOSS' | 'DRAW' | 'BYE';
export type MatchState = 'WAITING_FOR_SLOTS' | 'READY' | 'COMPLETED' | 'SKIPPED';
export type BlockState = 'PENDING' | 'SKIPPED' | 'SEEDING_AND_PAIRING' | 'IN_PROGRESS' | 'RESOLVING' | 'COMPLETED';
export type TransferMode = 'BATCH' | 'STREAMING';
export type StatsResetPolicy = 'KEEP_ALL' | 'ARCHIVE_AND_RESET_ALL' | 'RESET_POINTS_KEEP_HISTORY';
export type SeedingTransform = 'KEEP' | 'REVERSE' | 'SHUFFLE' | 'CROSS_OVER' | 'SNAKE';
export type RankingCriterion = 'points' | 'buchholzScore' | 'scoreDifference' | 'wins' | 'headToHead' | 'initialSeed';

export interface PointsConfig {
  win: number;
  draw: number;
  loss: number;
  bye: number;
  forfeitWinScore: number;  // Score attribué par défaut en cas de forfait adverse (ex: 1)
  forfeitLossScore: number; // Score attribué au forfaitaire (ex: 0)
}

export interface TeamBase {
  id: string;
  name: string;
  initialSeed: number;
  customMeta?: Record<string, unknown>;
}

export interface MatchHistoryEntry {
  stageId: string;
  blockId: string;
  matchId: string;
  opponentId: string | 'BYE';
  result: MatchOutcome;
  scoreFor: number;
  scoreAgainst: number;
}

export interface TeamStats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  points: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  buchholzScore: number;
  currentStreak: number; // Positif = série de victoires, Négatif = série de défaites
}

export interface ArchivedStage {
  stageId: string;
  sourceBlockId: string;
  finalSeedInStage: number;
  stats: TeamStats;
  history: MatchHistoryEntry[];
}

export interface EnrichedTeam extends TeamBase {
  currentSeed: number;
  status: TeamStatus;
  originConnectorId?: string;
  currentStageId: string;
  currentStageStats: TeamStats;
  currentStageHistory: MatchHistoryEntry[];
  pastStages: ArchivedStage[];
}

export type ParticipantSlot =
  | { type: 'RESOLVED'; teamId: string }
  | { type: 'BYE' }
  | { type: 'PENDING_POINTER'; sourceBlockId: string; sourceMatchId: string; outcome: 'WINNER' | 'LOSER' };

export interface Match {
  id: string;              // Format déterministe : `${blockId}:m${matchIndex}`
  blockId: string;
  roundNumber: number;
  matchIndex: number;      // 0, 1, 2...
  slotA: ParticipantSlot;
  slotB: ParticipantSlot;
  scoreA?: number;
  scoreB?: number;
  winnerId?: string | 'DRAW';
  loserId?: string | 'DRAW';
  state: MatchState;
}

/**
 * DSL Déclaratif 100% Sérialisable en JSON pour filtrer les équipes dans un Connecteur
 */
export type FilterRuleDSL =
  | { type: 'ALL' }
  | { type: 'WINNERS' }
  | { type: 'LOSERS' }
  | { type: 'TOP_N'; count: number }
  | { type: 'BOTTOM_N'; count: number }
  | { type: 'RANGE'; startRank: number; endRank: number } // 1-based inclusive (ex: 3 à 6)
  | { type: 'MIN_POINTS'; points: number }
  | { type: 'EXACT_WINS'; wins: number }
  | { type: 'EXACT_LOSSES'; losses: number };

/**
 * DSL Déclaratif 100% Sérialisable en JSON pour le court-circuit conditionnel d'un Bloc (ex: Bracket Reset)
 */
export type SkipConditionDSL =
  | { type: 'NEVER' }
  | { type: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED'; connectorId: string }
  | { type: 'SKIP_IF_FEWER_TEAMS_THAN'; minTeams: number }
  | { type: 'SKIP_IF_ALL_TEAMS_HAVE_MIN_WINS'; wins: number };

export interface ConnectorConfig {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  transferMode: TransferMode;
  filterRule: FilterRuleDSL;
  seedingTransform?: SeedingTransform;
  statsResetPolicy: StatsResetPolicy;
  targetStageId?: string;
  rankingCriteria?: RankingCriterion[];
}

export interface BlockConfigBase {
  id: string;
  stageId?: string;
  roundNumber?: number;
  skipCondition?: SkipConditionDSL;
  rankingCriteria?: RankingCriterion[];
}
```

### 2.2. Fichier `src/types/events.types.ts`

```typescript
import { TeamBase, BlockConfigBase, ConnectorConfig, EnrichedTeam, Match, BlockState, PointsConfig } from './domain.types';

export type TournamentEventPayload =
  | { type: 'TOURNAMENT_INITIALIZED'; prngSeed: number; pointsConfig: PointsConfig }
  | { type: 'TEAMS_SEEDED'; blockId: string; teams: TeamBase[] }
  | { type: ' TOURNAMENT_STARTED' }
  | {
      type: 'MATCH_RESULT_REPORTED';
      blockId: string;
      matchId: string;
      expectedTeams: [string, string];   // [teamAId, teamBId] au moment de la saisie
      scores: Record<string, number>;    // Clé = teamId, Valeur = score (Sécurise le Causal Replay !)
      winnerOverrideId?: string | 'DRAW';
    }
  | { type: 'TEAM_DROPPED'; teamId: string; reason?: string }
  | { type: 'ROUND_PAIRINGS_LOCKED'; blockId: string; lockedPairs: Array<[string, string | 'BYE']> }
  | { type: 'MANUAL_SEED_OVERRIDE'; blockId: string; orderedTeamIds: string[] }
  | { type: 'TIE_BREAKER_RESOLVED'; connectorId: string; orderedTeamIds: string[] };

export interface TournamentEvent {
  eventId: string;        // Format déterministe : `evt_${sequenceIndex}_${shortHash}`
  sequenceIndex: number;  // 0, 1, 2...
  timestamp: number;      // Fourni en option ou index séquentiel (n'influence jamais le stateHash)
  payload: TournamentEventPayload;
  stateHash: string;      // Hash FNV-1a déterministe de l'état après application de l'événement
}

export interface OrphanedEventInfo {
  event: TournamentEvent;
  reason: string;
}

export interface RebaseResult {
  appliedEvents: TournamentEvent[];
  orphanedEvents: OrphanedEventInfo[];
  newHeadStateHash: string;
}

export interface SerializedBlockState {
  id: string;
  blockType: 'BRACKET' | 'SWISS' | 'ROUND_ROBIN' | 'MERGER';
  config: Record<string, unknown>;
  state: BlockState;
  inputTeamIds: string[];
  outputTeamIds: string[];
  matches: Match[];
  pairingsLocked: boolean;
  lockedPairs?: Array<[string, string | 'BYE']>;
  receivedConnectors: string[];
}

export interface SerializedTournamentSnapshot {
  sequenceIndex: number;
  lastEventId: string;
  prngState: number;
  pointsConfig: PointsConfig;
  teams: Array<[string, EnrichedTeam]>;
  blocks: SerializedBlockState[];
  connectors: ConnectorConfig[];
  manualTieBreakers: Array<[string, string[]]>; // connectorId -> orderedTeamIds
}

export interface SerializedTournamentFull {
  version: '3.0.0';
  initialPrngSeed: number;
  pointsConfig: PointsConfig;
  blockDefinitions: Array<{ blockType: string; config: Record<string, unknown> }>;
  connectorDefinitions: ConnectorConfig[];
  timeline: TournamentEvent[];
}
```

---

## 3. Classes Utilitaires & Core (`src/utils/` & `src/core/`)

### 3.1. `DeterministicPRNG` (`src/utils/prng.ts`)
Générateur pseudo-aléatoire basé sur l'algorithme **Mulberry32** ($32\text{-bit}$).
* **Propriétés privées :** `private state: number;`
* **Constructeur :** `constructor(seed: number)` — Initialise `this.state = seed >>> 0`.
* **Méthodes à implémenter :**
  * `nextFloat(): number` : Exécute un pas Mulberry32 et retourne un nombre dans $[0, 1[$.
  * `nextInt(min: number, maxInclusive: number): number` : Retourne un entier déterministe dans $[min, maxInclusive]$.
  * `shuffle<T>(array: readonly T[]): T[]` : Retourne une nouvelle copie mélangée via l'algorithme de **Fisher-Yates** en utilisant `this.nextInt()`. Ne modifie pas le tableau d'entrée.
  * `getState(): number` : Retourne `this.state`.
  * `setState(state: number): void` : Restaure `this.state = state >>> 0`.

### 3.2. `StateHasher` (`src/utils/hash.ts`)
* **Méthode statique :** `static computeHash(data: unknown): string`
  * Sérialise de manière canonique (clés d'objets triées alphabétiquement) l'objet passé et calcule une empreinte hexadécimale $32\text{-bit}$ via l'algorithme **FNV-1a** (`offset_basis = 2166136261`, `prime = 16777619`).

### 3.3. `StandingsCalculator` (`src/utils/standings.ts`)
* **Méthode statique :**
  ```typescript
  static sortTeams(
    teams: EnrichedTeam[],
    criteria: RankingCriterion[],
    manualTieBreakerOrder?: string[]
  ): EnrichedTeam[]
  ```
* **Algorithme de tri :**
  1. Retourne une copie triée des équipes.
  2. Pour deux équipes $A$ et $B$, itère dans l'ordre sur `criteria` (par défaut : `['points', 'buchholzScore', 'scoreDifference', 'wins', 'headToHead', 'initialSeed']`) :
     * `'points'` : Décroissant (`B.currentStageStats.points - A.currentStageStats.points`).
     * `'buchholzScore'` : Décroissant.
     * `'scoreDifference'` : Décroissant.
     * `'wins'` : Décroissant.
     * `'headToHead'` : Cherche dans `A.currentStageHistory` les affrontements directs contre `B.id`. Celle qui a le plus de victoires directes passe devant.
     * `'initialSeed'` : Croissant (`A.initialSeed - B.initialSeed`).
  3. Si une liste `manualTieBreakerOrder` est fournie et contient à la fois `A.id` et `B.id`, l'ordre manuel prévaut juste avant `'initialSeed'`.
  4. En dernier recours absolu, tri lexicographique sur `id` (`A.id.localeCompare(B.id)`) pour garantir un déterminisme total.

### 3.4. `TournamentRegistry` (`src/core/registry.ts`)
Dictionnaire central maintenant l'état enrichi de toutes les équipes.
* **Propriétés privées :** `private teams: Map<string, EnrichedTeam> = new Map();`
* **Méthodes publiques :**
  * `registerTeams(baseTeams: TeamBase[], stageId: string): void` : Crée les `EnrichedTeam` initiales avec `status: 'ACTIVE'`, `currentSeed: initialSeed`, `currentStageStats` à zéro.
  * `getTeam(teamId: string): EnrichedTeam` : Retourne une copie ou la référence de l'équipe (lève une erreur explicite si introuvable).
  * `getAllTeams(): EnrichedTeam[]` : Retourne toutes les équipes.
  * `updateTeam(team: EnrichedTeam): void` : Met à jour l'équipe dans la `Map`.
  * `recordMatchOutcome(teamId: string, entry: MatchHistoryEntry, pointsConfig: PointsConfig): void` :
    * Ajoute `entry` à `currentStageHistory`.
    * Incrémente `played` (sauf si `BYE` ou selon convention : un `BYE` incrémente `byes` et `wins`, ajoute `pointsConfig.bye` aux `points`).
    * Met à jour `wins`, `losses`, `draws`, `scoreFor`, `scoreAgainst`, `scoreDifference`, `points`, et `currentStreak`.
  * `recomputeAllBuchholzScores(): void` :
    * Pour chaque équipe $T$ du registre : parcourt `T.currentStageHistory`. Pour chaque entrée où `opponentId !== 'BYE'`, récupère l'adversaire $O$ dans le `TournamentRegistry` (même si $O$ a le statut `'DROPPED'` ou `'ELIMINATED'`) et additionne `O.currentStageStats.points` (si $O$ est toujours dans la même phase) ou les points de $O$ archivés pour ce `stageId`. Met à jour `T.currentStageStats.buchholzScore`.
  * `applyStatsReset(teamId: string, policy: StatsResetPolicy, newStageId: string): void` :
    * Si `'KEEP_ALL'` : change uniquement `currentStageId = newStageId`.
    * Si `'ARCHIVE_AND_RESET_ALL'` : pousse `{ stageId: team.currentStageId, sourceBlockId: '', finalSeedInStage: team.currentSeed, stats: structuredClone(team.currentStageStats), history: structuredClone(team.currentStageHistory) }` dans `pastStages`, puis réinitialise `currentStageStats` à $0$ et `currentStageHistory` à `[]`.
    * Si `'RESET_POINTS_KEEP_HISTORY'` : archive la phase dans `pastStages`, remet `currentStageStats` à $0$, mais **conserve** `currentStageHistory` intact pour interdire les rematches ultérieurs.
  * `serialize(): Array<[string, EnrichedTeam]>` & `restore(data: Array<[string, EnrichedTeam]>): void` (avec clonage profond).

---

## 4. Spécification du Connecteur (`src/core/connector.ts`)

### Classe `Connector`
* **Propriétés :** `readonly config: ConnectorConfig;`
* **Constructeur :** `constructor(config: ConnectorConfig)`
* **Méthodes publiques :**
  * `filterTeams(teams: EnrichedTeam[], sourceMatches: Match[], registry: TournamentRegistry, manualTieBreaker?: string[]): EnrichedTeam[]`
    * Trie d'abord `teams` via `StandingsCalculator.sortTeams(teams, this.config.rankingCriteria ?? [...], manualTieBreaker)` (en excluant systématiquement les équipes dont `status === 'DROPPED'`).
    * Applique `this.config.filterRule` :
      * `'ALL'` : retourne toutes les équipes actives.
      * `'WINNERS'` : retourne les équipes ayant gagné leur match dans `sourceMatches` (ou ayant eu un `BYE`).
      * `'LOSERS'` : retourne les équipes ayant perdu leur match dans `sourceMatches`.
      * `'TOP_N'` : retourne `sorted.slice(0, rule.count)`.
      * `'BOTTOM_N'` : retourne `sorted.slice(-rule.count)`.
      * `'RANGE'` : retourne `sorted.slice(rule.startRank - 1, rule.endRank)`.
      * `'MIN_POINTS'` : filtre `t.currentStageStats.points >= rule.points`.
      * `'EXACT_WINS'` / `'EXACT_LOSSES'` : filtre sur `currentStageStats.wins` / `losses`.
  * `transformSeeding(teams: EnrichedTeam[], prng: DeterministicPRNG): EnrichedTeam[]`
    * Applique `this.config.seedingTransform ?? 'KEEP'` :
      * `'KEEP'` : conserve l'ordre et réindexe `currentSeed` de $1$ à $N$.
      * `'REVERSE'` : inverse l'ordre du tableau puis réindexe `currentSeed` de $1$ à $N$.
      * `'SHUFFLE'` : utilise `prng.shuffle(teams)` puis réindexe `currentSeed` de $1$ à $N$.
      * `'CROSS_OVER'` : coupe la liste en deux moitiés et entrelace la première moitié avec la seconde moitié inversée ($1, N, 2, N-1, \dots$).
      * `'SNAKE'` : ordonnancement en serpentin.

---

## 5. Hiérarchie des Blocs (`src/blocks/`)

### 5.1. Classe Abstraite `AbstractTournamentBlock` (`src/blocks/abstract-block.ts`)
* **Propriétés :**
  * `readonly id: string;`
  * `readonly blockType: 'BRACKET' | 'SWISS' | 'ROUND_ROBIN' | 'MERGER';`
  * `readonly config: BlockConfigBase;`
  * `protected state: BlockState = 'PENDING';`
  * `protected inputTeamIds: string[] = [];`
  * `protected outputTeamIds: string[] = [];`
  * `protected matches: Match[] = [];`
  * `protected pairingsLocked: boolean = false;`
  * `protected lockedPairs?: Array<[string, string | 'BYE']>;`
  * `protected receivedConnectors: Set<string> = new Set();`
* **Méthodes abstraites à implémenter par les sous-classes :**
  * `abstract generateMatches(registry: TournamentRegistry, prng: DeterministicPRNG, pointsConfig: PointsConfig): void;`
  * `abstract serializeConfig(): Record<string, unknown>;`
* **Méthodes concrètes de gestion du cycle de vie :**
  * `evaluateSkipCondition(teams: EnrichedTeam[]): boolean` :
    * Évalue `this.config.skipCondition`.
    * Pour `'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED'` : vérifie si l'équipe dont `originConnectorId === rule.connectorId` possède `currentStageStats.losses === 0`. Si oui, retourne `true` (cas du Bracket Reset inutile quand le vainqueur du Winner Bracket gagne la première Grande Finale).
  * `receiveBatchTeams(teamIds: string[], connectorId: string | undefined, expectedInputsCount: number, registry: TournamentRegistry, prng: DeterministicPRNG, pointsConfig: PointsConfig): void` :
    * Ajoute `teamIds` dans `inputTeamIds` (sans doublons).
    * Si tous les connecteurs entrants attendus ont livré leurs équipes :
      * Si `evaluateSkipCondition()` est `true`, passe `state = 'SKIPPED'`, copie `inputTeamIds` dans `outputTeamIds`, puis passe directement `state = 'COMPLETED'`.
      * Sinon, passe `state = 'SEEDING_AND_PAIRING'`, appelle `generateMatches()`, puis passe `state = 'IN_PROGRESS'` (ou `'COMPLETED'` si tous les matchs étaient des `BYE` auto-résolus).
  * `findMatchForResult(matchId: string, expectedTeams: [string, string]): { match: Match; swapped: boolean } | null` :
    * **Méthode clé pour la Time Machine (V2.1) :**
    * Cherche d'abord le match ayant `m.id === matchId` et `m.state === 'READY'`. Vérifie si ses `slotA` et `slotB` résolus correspondent à `expectedTeams[0]` et `expectedTeams[1]` (dans cet ordre ou dans l'ordre inverse).
    * Si non trouvé (ex: décalage de table en Ronde Suisse lors d'un *Causal Replay*), parcourt **tous** les matchs `READY` du bloc pour trouver celui qui oppose exactement `expectedTeams[0]` et `expectedTeams[1]`.
    * Retourne `{ match, swapped: true }` si `slotA.teamId === expectedTeams[1]`, `{ match, swapped: false }` si `slotA.teamId === expectedTeams[0]`, ou `null` si ce duel n'existe plus dans la nouvelle timeline.

### 5.2. `BracketRoundBlock` (`src/blocks/bracket-block.ts`)
Modélise un tour d'élimination (Simple ou Double).
* **Algorithme de `generateMatches()` (Mode `BATCH` ou initial) :**
  1. Trie les équipes entrantes par `currentSeed` croissant.
  2. Soit $N$ le nombre d'équipes. Si $N \le 1$, le bloc passe immédiatement en `COMPLETED`.
  3. Calcule la puissance de $2$ supérieure ou égale : $P = 2^{\lceil \log_2(N) \rceil}$.
  4. Le nombre de matchs générés est $M = P / 2$. Le nombre de `BYE` est $B = P - N$.
  5. Appariement standard de bracket (*Fold Seeding*) : le Seed $i$ ($1 \le i \le M$) affronte le Seed $P + 1 - i$. Si $P + 1 - i > N$, le `slotB` est `{ type: 'BYE' }`.
  6. Tout match ayant un slot `{ type: 'BYE' }` est immédiatement résolu à l'état `'COMPLETED'` avec `winnerId = slotA.teamId`, `scoreA = pointsConfig.forfeitWinScore`, `scoreB = 0`, et met à jour le `TournamentRegistry`.
* **Support du Mode `STREAMING` :**
  * Méthode `initializeStreamingSlots(sourceBlock: AbstractTournamentBlock, outcome: 'WINNER' | 'LOSER', connectorId: string)` :
    * Pré-génère les matchs du `BracketRoundBlock` avec des `slotA` et `slotB` de type `PENDING_POINTER` pointant vers les matchs du `sourceBlock`.
    * Passe l'état du bloc à `'IN_PROGRESS'`.
  * Méthode `resolveStreamingSlot(sourceMatchId: string, outcome: 'WINNER' | 'LOSER', resolvedTeamId: string | 'BYE', registry: TournamentRegistry, pointsConfig: PointsConfig): Match[]` :
    * Parcourt les matchs en `'WAITING_FOR_SLOTS'`. Remplace tout `PENDING_POINTER` correspondant par `{ type: 'RESOLVED', teamId: resolvedTeamId }` (et met à jour `team.originConnectorId`).
    * Dès que `slotA` et `slotB` d'un match sont tous deux `'RESOLVED'`, son état passe immédiatement à `'READY'`. Si l'un des deux est `'BYE'` (ou si l'équipe est `'DROPPED'`), le match est auto-résolu en `'COMPLETED'`.

### 5.3. `SwissRoundBlock` (`src/blocks/swiss-block.ts`)
Modélise une ronde de Système Suisse (Système Néerlandais / Monrad avec Backtracking).
* **Algorithme de `generateMatches()` :**
  1. Si `this.pairingsLocked === true` et `this.lockedPairs` est défini (suite à un événement `ROUND_PAIRINGS_LOCKED`), génère exactement les matchs dictés par `this.lockedPairs` sans recalculer le classement (permet d'éviter l'effet papillon en Ronde Suisse).
  2. Sinon, filtre les équipes entrantes ayant `status === 'ACTIVE'`.
  3. Trie les équipes via `StandingsCalculator.sortTeams(activeTeams, ['points', 'buchholzScore', 'scoreDifference', 'initialSeed'])`.
  4. Si le nombre d'équipes actives est impair :
     * Parcourt la liste triée **de la fin vers le début** (du moins bien classé au mieux classé).
     * Choisit la première équipe ayant `currentStageStats.byes === 0`. (Si toutes ont déjà eu un bye, choisit la dernière équipe).
     * Crée un match contre `{ type: 'BYE' }`, le résout immédiatement en `'COMPLETED'`, et retire cette équipe de la liste à apparier.
  5. **Appariement Récursif avec Backtracking (`findValidPairing(remainingTeams: EnrichedTeam[], allowRematchFallback: boolean)`) :**
     * Regroupe ou ordonne `remainingTeams` par paliers de `points` décroissants, puis par `currentSeed`.
     * Fonction récursive : prend la première équipe $T_1 = \text{remaining}[0]$.
     * Parcourt les candidats $T_k \in \text{remaining}[1 \dots]$ :
       * Vérifie la contrainte de non-rematch : $T_1$ ne doit pas avoir `opponentId === T_k.id` dans `T_1.currentStageHistory`.
       * Si valide (ou si `allowRematchFallback === true`), tente récursivement d'apparier `remaining` privé de $\{T_1, T_k\}$.
       * Si l'appel récursif réussit, retourne `[[T_1, T_k], ...subPairs]`.
     * Si aucun couplage sans rematch n'existe (graphe bloqué), relance `findValidPairing(remainingTeams, true)` pour garantir l'absence totale de *deadlock*.

### 5.4. `RoundRobinBlock` & `RoundRobinStageMacro` (`src/blocks/round-robin-block.ts`)
* **`RoundRobinBlock` (Atomique - 1 Journée) :**
  * Propriété de config : `roundIndex: number` ($0 \le \text{roundIndex} < N_{\text{even}} - 1$).
  * **Algorithme du Polygone de Berger dans `generateMatches()` :**
    1. Si $N$ est impair, ajoute un participant virtuel `'BYE'` pour obtenir $N_{\text{even}} = N + 1$.
    2. Fixe l'équipe à l'index $0$ en haut à gauche.
    3. Fait tourner les $N_{\text{even}} - 1$ autres équipes dans le sens horaire de `roundIndex` positions :
       * Soit `rotating = teams.slice(1)`.
       * Pour un décalage $r = \text{roundIndex} \pmod{N_{\text{even}} - 1}$, réordonne le tableau tournant.
    4. Apparie l'élément $i$ ($0 \le i < N_{\text{even}} / 2$) avec l'élément $N_{\text{even}} - 1 - i$.
    5. Alterne Domicile/Extérieur (`slotA`/`slotB`) pour l'équipe pivot (index $0$) aux journées impaires afin d'équilibrer les réceptions.
* **`RoundRobinStageMacro` (Helper de construction) :**
  * Méthode statique `createStage(stageId: string, numTeams: number, doubleRoundRobin?: boolean): { blocks: RoundRobinBlock[]; connectors: ConnectorConfig[] }` :
    * Génère automatiquement les $R = (N \text{ pair } ? N - 1 : N)$ instances de `RoundRobinBlock` (multiplié par $2$ si `doubleRoundRobin === true`) et les connecteurs `BATCH` (`filterRule: { type: 'ALL' }`, `statsResetPolicy: 'KEEP_ALL'`) qui les relient en chaîne.

### 5.5. `MergerBlock` (`src/blocks/merger-block.ts`)
Bloc de synchronisation et de ré-ordonnancement (ex: regrouper les qualifiés de $4$ poules avant un arbre final).
* Ne génère **aucun match** (`matches = []`).
* Attend que tous ses connecteurs parents (ex: $4$ connecteurs `BATCH`) aient poussé leurs équipes qualifiées.
* Dès que toutes les entrées sont reçues, trie globalement les équipes via `StandingsCalculator.sortTeams()`, réattribue les `currentSeed` de $1$ à $K$, place toutes les équipes dans `outputTeamIds` et passe directement à l'état `'COMPLETED'`.

---

## 6. Moteur Principal & Time Machine (`src/core/time-machine.ts` & `src/engine/tournament-graph.ts`)

### 6.1. `TimeMachine` (`src/core/time-machine.ts`)
Gère le journal d'événements immuable, le cache LRU de snapshots et la réécriture causale du passé.
* **Propriétés :**
  * `private timeline: TournamentEvent[] = [];`
  * `private snapshots: Map<number, SerializedTournamentSnapshot> = new Map();` (Clé = `sequenceIndex`)
  * `private readonly maxSnapshots: number;` (Défaut : $12$, politique LRU mais conserve toujours le snapshot d'index $0$)
  * `private readonly snapshotInterval: number;` (Défaut : $10$ événements)
* **Méthodes publiques :**
  * `getTimeline(): readonly TournamentEvent[]` : Retourne une copie en lecture seule de la timeline.
  * `recordEvent(payload: TournamentEventPayload, currentStateHash: string, timestamp?: number): TournamentEvent` :
    * Crée l'événement d'index `sequenceIndex = this.timeline.length`, calcule son `eventId = "evt_" + sequenceIndex + "_" + currentStateHash.slice(0, 6)`, l'ajoute à `timeline`.
  * `saveSnapshotIfNeeded(sequenceIndex: number, snapshot: SerializedTournamentSnapshot): void` :
    * Sauvegarde si `sequenceIndex === 0` ou `sequenceIndex % this.snapshotInterval === 0`. Si `snapshots.size > maxSnapshots`, supprime le plus ancien snapshot dont la clé est $> 0$.
  * `getNearestSnapshotBefore(targetSequenceIndex: number): SerializedTournamentSnapshot` :
    * Trouve le snapshot ayant le plus grand `sequenceIndex <= targetSequenceIndex`.

### 6.2. Algorithme Exact du *Causal Replay* (`amendEvent` & `insertEventAt`)
Lorsqu'on appelle `tournament.timeMachine.amendEvent(targetEventId, newPayload)` :
1. **Recherche :** Trouve l'index $k$ de `targetEventId` dans `this.timeline`. Lève une erreur si introuvable ou si $k = 0$ (`TOURNAMENT_INITIALIZED`).
2. **Sauvegarde de la Queue :** Extrait les événements aval `tailEvents = this.timeline.slice(k + 1)`.
3. **Restauration d'État :**
   * Tronque la timeline à $k - 1$.
   * Récupère le snapshot le plus proche $\le k - 1$, restaure le `TournamentGraph` à cet état et rejoue les événements jusqu'à $k - 1$.
4. **Application de la Modification :**
   * Applique `newPayload` à l'index $k$ via le moteur interne du `TournamentGraph`.
5. **Boucle de Rejeu Causal sur `tailEvents` :**
   * Initialise `appliedEvents: TournamentEvent[] = []` et `orphanedEvents: OrphanedEventInfo[] = []`.
   * Pour chaque ancien événement $E \in \text{tailEvents}$ :
     * **Cas A : `E.payload.type === 'MATCH_RESULT_REPORTED'`**
       1. Récupère le bloc `block = graph.getBlock(E.payload.blockId)`.
       2. Appelle `block.findMatchForResult(E.payload.matchId, E.payload.expectedTeams)`.
       3. Si la méthode retourne `null` (ces deux équipes ne s'affrontent plus dans ce bloc suite au changement passé) :
          * Ajoute `{ event: E, reason: 'Match pairing no longer exists in recalculated timeline' }` dans `orphanedEvents`.
       4. Si la méthode retourne `{ match, swapped }` :
          * Récupère les scores nominatifs depuis `E.payload.scores[teamAId]` et `E.payload.scores[teamBId]`.
          * Applique le résultat sur le nouveau `match.id` avec les scores dans le bon sens (`slotA` / `slotB`), enregistre le nouvel événement dans `appliedEvents`.
     * **Cas B : `E.payload.type === 'TIE_BREAKER_RESOLVED'`**
       1. Vérifie si les équipes mentionnées dans `E.payload.orderedTeamIds` sont toujours présentes et à égalité dans le bloc source du connecteur. Sinon, place $E$ dans `orphanedEvents`.
     * **Cas C : Autres événements (`TEAM_DROPPED`, `ROUND_PAIRINGS_LOCKED`, `MANUAL_SEED_OVERRIDE`)**
       1. Tente d'appliquer l'événement dans un bloc `try / catch`. S'il est valide dans le nouvel état, l'ajoute à `appliedEvents`, sinon l'ajoute à `orphanedEvents` avec le message d'erreur.
6. **Retour :** Retourne `{ appliedEvents, orphanedEvents, newHeadStateHash }`.

### 6.3. Classe Façade `TournamentGraph` (`src/engine/tournament-graph.ts`)
Orchestrateur central exposant l'API publique.

```typescript
export interface TournamentGraphOptions {
  prngSeed?: number;          // Défaut: 42
  pointsConfig?: Partial<PointsConfig>;
  snapshotInterval?: number;  // Défaut: 10
  maxSnapshots?: number;      // Défaut: 12
}

export class TournamentGraph {
  public readonly registry: TournamentRegistry;
  public readonly timeMachine: TimeMachine;
  
  constructor(options?: TournamentGraphOptions);

  // Configuration de la topologie du DAG (avant start())
  public addBlock(block: AbstractTournamentBlock): this;
  public addBlocks(blocks: AbstractTournamentBlock[]): this;
  public connect(sourceBlockId: string, targetBlockId: string, config: Omit<ConnectorConfig, 'id' | 'sourceBlockId' | 'targetBlockId'> & { id?: string }): this;

  // Actions mutatives (Génèrent chacune un TournamentEvent dans la TimeMachine)
  public seedTeams(teams: TeamBase[], entryBlockId: string): TournamentEvent;
  public start(): TournamentEvent;
  public reportMatchResult(
    matchId: string,
    result: { scoreA: number; scoreB: number; winnerOverrideId?: string | 'DRAW' }
  ): TournamentEvent;
  public dropTeam(teamId: string, reason?: string): TournamentEvent;
  public lockRoundPairings(blockId: string): TournamentEvent;
  public overrideSeeds(blockId: string, orderedTeamIds: string[]): TournamentEvent;
  public resolveTieBreaker(connectorId: string, orderedTeamIds: string[]): TournamentEvent;

  // Requêtes et Lecture d'État (Sans effet de bord)
  public getPlayableMatches(blockId?: string): Match[];
  public getAllMatches(blockId?: string): Match[];
  public getStandings(stageOrBlockId?: string): EnrichedTeam[];
  public getBlock(blockId: string): AbstractTournamentBlock;
  public getStateHash(): string;

  // Sérialisation & Clonage temporel
  public toJSON(): SerializedTournamentFull;
  public static fromJSON(json: SerializedTournamentFull): TournamentGraph;
}
```

### 6.4. Propagation Automatique dans `TournamentGraph`
Lorsqu'un événement `MATCH_RESULT_REPORTED` ou `TEAM_DROPPED` est appliqué dans `TournamentGraph` :
1. Le match cible passe à `'COMPLETED'`. Le `TournamentRegistry` met à jour les statistiques des deux équipes (`recordMatchOutcome`) et recalcule les scores Buchholz (`recomputeAllBuchholzScores`).
2. **Propagation `STREAMING` immédiate :**
   * Le graphe inspecte tous les connecteurs sortants du bloc ayant `transferMode === 'STREAMING'`.
   * Pour un connecteur `WINNERS`, propage immédiatement `match.winnerId` vers le `BracketRoundBlock` enfant via `resolveStreamingSlot()`.
   * Pour un connecteur `LOSERS`, propage immédiatement `match.loserId` (ou `'BYE'` si le match parent était un `BYE`, ce qui auto-qualifie l'adversaire dans le Loser Bracket !).
3. **Propagation `BATCH` en fin de bloc :**
   * Si $100\%$ des matchs du bloc courant sont `'COMPLETED'` (ou `'SKIPPED'`), le bloc passe par `'RESOLVING'` puis `'COMPLETED'`.
   * Le graphe inspecte tous les connecteurs sortants du bloc ayant `transferMode === 'BATCH'`.
   * Pour chaque connecteur :
     1. Filtre les équipes du bloc via `connector.filterTeams(...)`.
     2. Applique `registry.applyStatsReset(team.id, connector.config.statsResetPolicy, targetStageId)` sur chaque équipe qualifiée et met à jour `team.originConnectorId = connector.config.id`.
     3. Applique `connector.transformSeeding(qualifiedTeams, this.prng)`.
     4. Pousse les équipes dans le bloc cible via `targetBlock.receiveBatchTeams(...)`.
   * Les équipes non retenues par aucun connecteur sortant voient leur statut passer à `'ELIMINATED'` dans le `TournamentRegistry` (et le vainqueur d'un bloc terminal sans connecteur sortant passe à `'CHAMPION'`).

---

## 7. Scénarios de Validation (Tests Unitaires à Générer par l'Agent IA)

L'Agent IA doit créer un fichier de test `src/__tests__/tournament-engine.spec.ts` vérifiant obligatoirement les $5$ scénarios suivants :

1. **Scénario 1 : Tournoi Hybride Complet (Ronde Suisse $\rightarrow$ Top Cut Bracket)**
   * $8$ équipes en Ronde Suisse ($3$ rounds en mode `BATCH`, `KEEP_ALL`) avec calcul du Buchholz et vérification de non-rematch.
   * Connecteur `TOP_N: 4` avec `ARCHIVE_AND_RESET_ALL` vers demi-finales et finale (`BracketRoundBlock`).
   * Vérification que `pastStages` contient bien l'archive de la Ronde Suisse et que les points sont repartis à $0$ en phase finale.
2. **Scénario 2 : Double Élimination en Mode `STREAMING` & Bracket Reset (`SkipConditionDSL`)**
   * $4$ équipes en Double Élimination avec connecteurs `STREAMING`.
   * Vérification qu'un match du Round 2 devient `'READY'` dès que ses deux matchs parents du Round 1 sont terminés, sans attendre le reste du tournoi.
   * Vérification du bloc de Grande Finale Reset configuré avec `{ type: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED', connectorId: 'upper-final-conn' }` :
     * Cas A : Le joueur du Winner Bracket gagne la Grande Finale $1$ $\rightarrow$ Le bloc de Bracket Reset passe en `'SKIPPED'` et le joueur est `'CHAMPION'`.
     * Cas B : Le joueur du Loser Bracket gagne la Grande Finale $1$ $\rightarrow$ Le bloc de Bracket Reset génère le match décisif.
3. **Scénario 3 : Time Machine & *Causal Replay* sur un Arbre (`amendEvent`)**
   * Saisie des Quarts de finale $M_1, M_2, M_3, M_4$, puis de la Demi-finale $S_1$ (issue de $M_1, M_2$) et $S_2$ (issue de $M_3, M_4$).
   * Modification du vainqueur de $M_1$ dans le passé via `timeMachine.amendEvent()`.
   * **Assertion critique :** Le résultat de $S_1$ doit se retrouver dans `rebaseResult.orphanedEvents`, tandis que les résultats de $M_2, M_3, M_4$ **ET** de la demi-finale $S_2$ doivent être **conservés et rejoués automatiquement** dans `rebaseResult.appliedEvents`.
4. **Scénario 4 : Clé Sémantique Nominative & Inversion de Table au Replay**
   * En Ronde Suisse, deux matchs sont joués au Round 2. On modifie un score du Round 1 de sorte que deux équipes qui s'affrontaient au Round 2 sur la Table 2 s'affrontent désormais sur la Table 1 avec inversion de leur position (`slotA` $\leftrightarrow$ `slotB`).
   * **Assertion critique :** `amendEvent` retrouve le match grâce à `expectedTeams` et réapplique les bons scores à chaque équipe grâce à la map nominative `scores: { [teamId]: score }`.
5. **Scénario 5 : Abandon (`TEAM_DROPPED`) & Pertinence du Buchholz**
   * Une équipe gagne au Round 1, puis abandonne (`dropTeam`) au Round 2.
   * Vérification que son match du Round 2 est gagné par forfait par son adversaire, qu'elle n'est plus appariée au Round 3, mais que son adversaire du Round 1 conserve son point de Buchholz au Round 3 grâce au `TournamentRegistry`.