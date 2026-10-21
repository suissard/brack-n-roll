# Brack'n'Roll

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

Prérequis : **Node.js 26 ou supérieur** (LTS depuis le 28/10/2026) et npm 11.
La version attendue est indiquée dans `package.json` (`engines`) et `.nvmrc` ;
`nvm use` ou `fnm use` sélectionne automatiquement la bonne version.

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

Trois vues sont disponibles depuis l'en-tête :

### Vue « Tournoi » (par défaut, orientée spectateurs)

- **Bandeau de tournoi** : format détecté automatiquement, statut, équipes
  encore en course, matchs joués, progression et champion.
- **Fil des matchs** : matchs prêts à jouer, prochains matchs et derniers
  résultats.
- **Visuel adaptatif au format** :
  - **Système suisse** : colonnes par ronde, statut de chaque ronde, scores et
    vainqueurs.
  - **Toutes rondes** : colonnes par journée.
  - **Élimination directe** : bracket avec connexions entre les tours, y
    compris les matchs projetés (« qualifié à désigner »).
  - **Double élimination** : tableau des gagnants, tableau des perdants,
    grande finale et bracket reset.
  - **Phases mixtes** : enchaînement suisse/toutes rondes → phase finale.
- **Classement général** : bilan cumulé sur toutes les phases, équipes
  qualifiées et statuts (en course, éliminé, champion).

### Vue « Console » (pilotage et debug)

- **Classement** live (points, Buchholz, différence, série, statut) avec
  **renommage en ligne** des équipes et bouton d'**abandon**.
- **Matchs** : saisie des scores (ou victoire rapide) sur les matchs `READY`,
  bascule vers la liste complète des matchs.
- **Seeding** : réordonnez les équipes par **glisser-déposer**, flèches ou
  saisie directe d'un **numéro de seed**. Chaque modification réécrit
  `TEAMS_SEEDED` dans la Time Machine et rejoue tout le tournoi.
- **Blocs du DAG** : état de chaque bloc, nombre de matchs, entrées/sorties.
- **Time Machine** : journal d'événements et **Causal Replay** —
  - **Amender** un résultat passé et voir les événements suivants rejoués ou
    orphelinés ;
  - **Supprimer** une ligne de la timeline et observer ses répercussions ;
  - **Revenir ici** pour remonter le temps (troncature de la timeline) ;
  - raccourci **◀ Revenir d'un événement** dans la barre d'outils.
- **Barre d'outils** : choix du scénario de démo, démarrage du tournoi, retour
  d'un événement, rechargement depuis la « base », purge du stockage, révision
  et hash d'état.

### Vue « Formats » (éditeur de tournoi)

- **Modèles intégrés** dérivés des scénarios de démo (suisse + top cut, double
  élimination, toutes rondes) et **format vierge**.
- **Édition complète du format** : nom, description, graine PRNG, barème de
  points, seeding ordonné des équipes (flèches et numéro de seed).
- **Blocs** : type (`SWISS`, `BRACKET`, `ROUND_ROBIN`, `MERGER`), identifiant,
  stage, ronde, journée (`roundIndex`), condition de court-circuit et critères
  de classement.
- **Connecteurs** : source/cible, mode `BATCH` / `STREAMING`, filtre du DSL
  (`TOP_N`, `WINNERS`, `RANGE`…), transformation de seeding, politique de
  réinitialisation des statistiques et stage cible.
- **Validation en direct** : identifiants dupliqués, bloc d'entrée manquant,
  connecteur orphelin ou auto-référent, seeding incohérent.
- **Sauvegarde locale** dans un **second faux backend** (`formatApi`), avec sa
  propre clé `localStorage`, sa révision et sa taille. Les formats intégrés
  restent immuables ; les formats personnalisés peuvent être dupliqués,
  modifiés et supprimés.
- **Ouvrir dans la console** : instancie le format (`createGraphFromFormat`),
  seed les équipes, démarre le tournoi et le persiste dans la base du tournoi
  courant.

Côté moteur, un format est un document JSON pur (`TournamentFormat`) :

```typescript
import { createGraphFromFormat, validateTournamentFormat } from './src/index';

const issues = validateTournamentFormat(format); // [] si le DAG est cohérent
const graph = createGraphFromFormat(format, { autoStart: true });
```

`TournamentGraph.toFormat({ id, name })` fait l'opération inverse : il exporte
la topologie et le seeding initial d'un tournoi existant, sans les résultats.

### Architecture du front

```text
web/
├── index.html
├── vite.config.ts
├── vite.config.singlefile.ts   # build autonome → index.html à la racine
├── tsconfig.json
└── src/
```

Le moteur est importé directement (`../../../src/index`), sans duplication.
Pour brancher une vraie base de données plus tard, il suffit de réimplémenter
`FakeDatabase` / `tournamentApi` avec la même interface asynchrone
(`load`, `save`, `clear`, `stats`).

Les formats disposent de leur propre façade `formatApi` et de leur propre
instance `FakeDatabase` (clé `brack-n-roll::formats-fake-db::v1`). Le
stockage des formats est donc totalement indépendant du tournoi en cours ; une
future base de données pourra être branchée sans toucher à l'éditeur.

### Build de la console

`npm run web:build` produit **deux sorties** :

| Sortie | Contenu | Usage |
| --- | --- | --- |
| `web/dist/` | build classique (JS + CSS séparés) | prévisualisation, serveur web |
| `./index.html` | build **single file** (JS + CSS inlinés) | GitHub Pages « Deploy from a branch », dossier `/ (root)` |

Les commandes détaillées sont aussi disponibles séparément :

```bash
npm run web:build:multi    # → web/dist/
npm run web:build:single   # → ./index.html (fichier unique autonome)
npm run web:preview        # prévisualisation du build web/dist/
```

### Déploiement sur GitHub Pages

Le dépôt est configuré pour publier **depuis la branche** :
**Settings → Pages → Build and deployment → Source** =
**Deploy from a branch**, branche `master`, dossier `/ (root)`.

GitHub Pages sert donc directement l'`index.html` single file présent à la
racine du dépôt. Il est **versionné** et doit être régénéré puis commité après
toute modification du front :

```bash
npm run web:build
git add index.html
git commit -m "build: régénérer l'index.html"
git push
```

Le workflow [`.github/workflows/web-ci.yml`](./.github/workflows/web-ci.yml) ne
déploie rien : il vérifie à chaque push / pull request que le front compile et
que l'`index.html` versionné est bien à jour. Si le contrôle échoue, relancez
`npm run web:build` et commitez le fichier.

Le build utilise des chemins relatifs (`base: './'`), il fonctionne donc aussi
bien sur `https://<utilisateur>.github.io/<dépôt>/` qu'avec un domaine
personnalisé. Comme tout est inliné, aucun autre fichier n'est nécessaire à
côté de l'`index.html`.

Si le dépôt est privé, GitHub Pages doit être disponible pour le plan utilisé.
L'URL publique est affichée dans **Settings → Pages**. Pour tester localement
le rendu de production :

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

`tests/time-machine-edit.spec.ts` couvre l'édition de la timeline et du seeding :
renommage d'équipe réversible, suppression d'une ligne (`deleteEvent`),
retour en arrière (`rewindTo`) et réécriture du seeding (`reseedTeams`) avec ses
conséquences sur les appariements et les résultats suivants.

`tests/formats.spec.ts` couvre les formats déclaratifs : export
(`toFormat`) sans la timeline, reconstruction jouable
(`createGraphFromFormat`), déterminisme du seeding et validation des
incohérences de topologie.

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
├── time-machine-edit.spec.ts
└── core.spec.ts
web/              # Console React (Vite) — voir section dédiée
```

## Licence

MIT
