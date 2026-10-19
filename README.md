# algo-tournament

Moteur algorithmique de tournoi modulaire (**DAG de blocs**) avec **Time Machine**
(Event Sourcing + Causal Replay), écrit en **TypeScript strict**, sans aucune
dépendance d'exécution.

> Spécification de référence : [`cahier_des_charges_moteur_de_tournoi.md`](./cahier_des_charges_moteur_de_tournoi.md)

## Fonctionnalités

- **Blocs** : élimination directe (simple/double, `BATCH` ou `STREAMING`),
  système suisse (Monrad + backtracking anti-rematch), toutes rondes
  (polygone de Berger), fusion de poules (`MergerBlock`).
- **Connecteurs** : filtrage 100 % JSON (`FilterRuleDSL`), transformations de
  seeding (`KEEP`, `REVERSE`, `SHUFFLE`, `CROSS_OVER`, `SNAKE`), politiques de
  remise à zéro des statistiques, propagation `BATCH` ou `STREAMING`.
- **Time Machine** : journal d'événements immuable, snapshots LRU, réécriture
  causale du passé (`amendEvent`) avec orphelinage des événements devenus
  incompatibles.
- **Déterminisme total** : PRNG Mulberry32 seedé, hash d'état FNV-1a, aucun
  `Math.random`, `Date.now` ou `crypto.randomUUID` dans la logique.
- **Clé sémantique nominative** : les résultats stockent les scores par
  `teamId`, ce qui survit à une inversion Domicile/Extérieur ou à un décalage
  de table lors d'un replay.
- **Sérialisation** : `toJSON()` / `TournamentGraph.fromJSON()` reconstruit
  l'état complet (topologie + rejeu de la timeline).

## Installation & commandes

```bash
npm install
npm test            # exécute la suite Vitest
npm run typecheck   # vérification TypeScript stricte (moteur + tests)
npm run build       # compilation vers dist/

npm run web:dev     # serveur de dev de la console React (http://localhost:5174)
npm run web:build   # build de production de la console
npm run web:preview # prévisualisation du build
```

## Démarrage rapide

```ts
import { TournamentGraph, SwissRoundBlock, BracketRoundBlock } from './src/index';

const graph = new TournamentGraph({ prngSeed: 42 });

graph.addBlock(new SwissRoundBlock({ id: 'swiss', stageId: 'swiss', roundNumber: 1 }));
graph.addBlock(new BracketRoundBlock({ id: 'final', stageId: 'playoffs', roundNumber: 1 }));

graph.connect('swiss', 'final', {
  transferMode: 'BATCH',
  filterRule: { type: 'TOP_N', count: 2 },
  statsResetPolicy: 'ARCHIVE_AND_RESET_ALL',
  targetStageId: 'playoffs',
});

graph.seedTeams(
  [
    { id: 't1', name: 'Alpha', initialSeed: 1 },
    { id: 't2', name: 'Bravo', initialSeed: 2 },
    { id: 't3', name: 'Charlie', initialSeed: 3 },
    { id: 't4', name: 'Delta', initialSeed: 4 },
  ],
  'swiss',
);

graph.start();

for (const match of graph.getPlayableMatches()) {
  graph.reportMatchResult(match.id, { scoreA: 2, scoreB: 0 });
}

console.log(graph.getPlayableMatches()); // matchs prêts
console.log(graph.getStandings());       // classement trié
```

## Front-end React (console de visualisation)

La console permet de visualiser et piloter un tournoi alimenté par les données
de test, **sans backend** : un faux client de base de données persiste dans le
`localStorage`.

```bash
npm run web:dev     # → http://localhost:5174
```

Fonctionnalités de l'interface :

- **Classement** live (points, Buchholz, différence, série, statut) avec bouton
  d'**abandon** d'une équipe.
- **Matchs** : saisie des scores (ou victoire rapide) sur les matchs `READY`,
  bascule vers la liste complète des matchs.
- **Blocs du DAG** : état de chaque bloc, nombre de matchs, entrées/sorties.
- **Time Machine** : journal d'événements et **Causal Replay** — on réécrit un
  résultat passé (`Amender`) et les événements suivants sont rejoués ou
  orphelinés, avec un récapitulatif.
- **Barre d'outils** : choix du scénario de démo, démarrage du tournoi,
  rechargement depuis la « base », purge du stockage, révision et hash d'état.

### Architecture du front

```text
web/
├── index.html
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx / App.tsx / styles.css
    ├── db/
    │   ├── fakeDatabase.ts    # faux client DB (collections, latence, révision) → localStorage
    │   └── tournamentApi.ts   # repository : SEUL point de contact avec le "backend"
    ├── store/
    │   ├── scenarios.ts       # jeux de données de démo (import des fixtures de test)
    │   └── tournamentStore.ts # store observable (useSyncExternalStore) + persistance
    ├── hooks/useTournament.ts
    └── components/            # StandingsTable, MatchesPanel, TimelinePanel
```

Le moteur est importé directement (`../../../src/index`), sans duplication.
Pour brancher une vraie base de données plus tard, il suffit de réimplémenter
`FakeDatabase` / `tournamentApi` avec la même interface asynchrone
(`load`, `save`, `clear`, `stats`).

### Déploiement automatique sur GitHub Pages

Le workflow [`.github/workflows/deploy-web.yml`](./.github/workflows/deploy-web.yml)
construit la console et la publie sur GitHub Pages à chaque push sur la branche
par défaut (`main` ou `master`), ou manuellement via
**Actions → Déploiement de la console web → Run workflow**.

Le build utilise des chemins relatifs (`base: './'`), il fonctionne donc aussi
bien sur `https://<utilisateur>.github.io/<dépôt>/` qu'avec un domaine
personnalisé.

Prérequis, une seule fois dans le dépôt :

1. **Settings → Pages → Build and deployment → Source** : choisir
   **GitHub Actions**.
2. Si le dépôt est privé, GitHub Pages doit être disponible pour le plan utilisé.

L'URL publique est affichée dans l'onglet **Actions** (job `deploy`) et dans
**Settings → Pages**. Pour tester localement le rendu de production :

```bash
npm run web:build
npm run web:preview
```

## Données de test

Les jeux de données sont dans [`tests/fixtures/`](./tests/fixtures) :

| Fichier | Contenu |
| --- | --- |
| `teams-4.json` | 4 équipes seedées 1..4 (double élimination, petits tournois) |
| `teams-8.json` | 8 équipes seedées 1..8 (suisse, arbre, top cut) |

Ils sont chargés par le helper [`tests/helpers.ts`](./tests/helpers.ts) (copie isolée
via `structuredClone`). Les scénarios de test construisent ensuite leurs propres
résultats de matchs de façon déterministe, ce qui rend les assertions
reproductibles.

## Tests (Vitest)

```bash
npm run test       # exécute toute la suite une fois
npm run test:watch # mode watch
```

`tests/tournament-engine.spec.ts` implémente les 5 scénarios du cahier des
charges :

1. **Tournoi hybride** : suisse 8 équipes (3 rondes, Buchholz, anti-rematch)
   → `TOP_N: 4` avec `ARCHIVE_AND_RESET_ALL` → demi-finales → finale.
2. **Double élimination `STREAMING`** : un match du Round 2 devient `READY`
   dès que ses deux parents sont terminés ; Bracket Reset court-circuité
   (`SKIP_IF_CONNECTOR_TEAM_UNDEFEATED`) si le joueur du Winner Bracket gagne,
   sinon match décisif.
3. **Causal Replay** : amendement d'un quart de finale ; seule la demi-finale
   impactée devient orpheline, l'autre est rejouée automatiquement.
4. **Clé nominative & inversion de table** : après modification d'un score,
   le duel est retrouvé par `expectedTeams` et les scores sont réappliqués par
   `teamId`, malgré `slotA`/`slotB` inversés.
5. **Abandon** : forfait auto-résolu, exclusion des appariements suivants et
   conservation du point de Buchholz de l'adversaire.

`tests/core.spec.ts` couvre en plus le PRNG, le hash, le classement,
le round-robin complet, le merger et le round-trip de sérialisation.

## Arborescence

```text
src/
├── types/        # Contrats de données (domaine + événements)
├── utils/        # PRNG, hash FNV-1a, classement multi-critères
├── core/         # Registry, Connecteur, Time Machine
├── blocks/       # Bracket, Swiss, Round Robin, Merger
├── engine/       # TournamentGraph (façade & orchestration DAG)
└── index.ts      # Exports publics
tests/
├── fixtures/     # Jeux de données JSON
├── helpers.ts    # Helpers partagés (chargement, matchs READY)
├── tournament-engine.spec.ts
└── core.spec.ts
web/              # Console React (Vite) — voir section dédiée
```

## Licence

MIT
