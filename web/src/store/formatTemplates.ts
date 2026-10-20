import { emptyTournamentFormat, type TournamentFormat } from '../../../src/index';
import { SCENARIOS, buildScenario } from './scenarios';

/**
 * Formats intégrés proposés comme points de départ.
 *
 * Ils sont dérivés des scénarios de démonstration : on ne conserve que la
 * topologie (blocs + connecteurs) et le seeding initial, pas les matchs déjà
 * joués. L'éditeur peut ainsi repartir d'un DAG fonctionnel puis le modifier.
 */

let cache: TournamentFormat[] | null = null;

export function getFormatTemplates(): TournamentFormat[] {
  if (!cache) {
    const templates = SCENARIOS.map((scenario) => {
      const graph = buildScenario(scenario.id);
      return graph.toFormat({
        id: `template:${scenario.id}`,
        name: scenario.name,
        description: scenario.description,
      });
    });
    templates.push(
      emptyTournamentFormat({
        id: 'template:blank',
        name: 'Format vierge',
        description: 'Un bloc suisse et 4 équipes : la base minimale pour construire un format.',
      }),
    );
    cache = templates;
  }

  return cache.map((format) => structuredClone(format));
}

export function getFormatTemplate(id: string): TournamentFormat | null {
  return getFormatTemplates().find((format) => format.id === id) ?? null;
}
