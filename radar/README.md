# Radar Lab

Laboratoire de validation du flux WPlace utilisé par le Radar.

## État actuel

Le lab contient maintenant quatre couches séparées :

1. `tile-inspector.js` — inspecte une tuile réelle et ses métadonnées HTTP/PNG ;
2. `png-decoder.js` — décode un PNG non interlacé en RGBA8 sans paquet externe ;
3. `tile-diff.js` — compare deux états d'une tuile et regroupe les pixels modifiés en régions ;
4. `scan-core.js` — transforme une différence en métriques et score d'observation.

Les tests déterministes sont dans `test-png-decoder.mjs` et `test-scan-core.mjs`.

## Objectif

Avant de brancher le Radar à D1, au cron Cloudflare ou aux alertes Discord, on valide séparément :

1. que le proxy fournit bien une tuile WPlace exploitable ;
2. que la réponse est un PNG valide ;
3. que les dimensions réelles de la tuile correspondent à ce que nous attendons ;
4. que le décodage donne des pixels fiables ;
5. que deux états peuvent être comparés efficacement ;
6. que les changements peuvent être regroupés en régions ;
7. ensuite seulement, le cycle de vie des événements et la persistance D1.

## Test local facultatif

Depuis la racine du dépôt :

```bash
node radar/test-png-decoder.mjs
node radar/test-scan-core.mjs
```

Le lab ne nécessite aucun paquet npm externe.

## Cache

Le endpoint utilisé par la carte et celui utilisé par le Radar doivent rester distincts :

- carte : cache long autorisé ;
- Radar : récupération fraîche nécessaire.

Le proxy de carte actuel force un cache Cloudflare long. Cloudflare documente que `cacheTtl` force le cache de la sous-requête Worker et que `cacheEverything` permet de traiter le contenu comme une ressource statique. Le Radar aura donc un endpoint dédié sans cache long.

## Prochaine étape

La prochaine couche est l'adaptateur de source Radar :

```text
/radar-tile/X/Y.png
        ↓
PNG decoder
        ↓
scan-core
```

Il sera ajouté au Worker proxy séparément du chemin `/tile/X/Y.png`, puis seulement testé sur une vraie tuile.

## Sécurité de déploiement

Le lab n'active aucun Cron, aucune alerte Discord et aucune surveillance automatique. Le moteur restera en mode observation tant que le pipeline réel n'aura pas été validé.
