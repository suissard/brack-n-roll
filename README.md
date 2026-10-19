# algo-tournament

Tournoi d'algorithmes — dépôt de résolution de défis algorithmiques.

## Structure

```text
algo-tournament/
├── src/             # Code source commun / bibliothèques utilitaires
├── challenges/      # Énoncés des défis (un dossier par challenge)
├── solutions/       # Vos solutions (un dossier par challenge)
├── tests/           # Tests unitaires et de validation
├── docs/            # Documentation et règles du tournoi
└── README.md
```

## Démarrage rapide

1. Clonez le dépôt :

   ```bash
   git clone <url-du-depot>
   cd algo-tournament
   ```

2. Consultez un challenge dans `challenges/` et implémentez votre solution dans `solutions/`.

3. Lancez les tests :

   ```bash
   # exemple (à adapter selon le langage)
   python -m pytest tests/
   ```

## Règles du tournoi

Voir `docs/`.

## Licence

MIT
