# Radar Lab

Laboratoire de validation du flux WPlace utilisé par le Radar.

## État actuel

Le lab contient maintenant six couches séparées :

1. `tile-inspector.js` — inspecte une tuile réelle et ses métadonnées HTTP/PNG ;
2. `png-decoder.js` — décode un PNG non interlacé en RGBA8 sans paquet externe ;
3. `tile-diff.js` — compare deux états d'une tuile et regroupe les pixels modifiés en régions ;
4. `scan-core.js` — transforme une différence en métriques et score d'observation ;
5. `tile-geometry.js` — convertit coordonnées géographiques, pixels monde et coordonnées de tuile ;
6. `wplace-source.js` — définit le contrat de récupération d'une tuile Radar fraîche et valide son PNG.

Les tests déterministes couvrent le décodeur PNG, le diff, la géométrie et la source WPlace.

## Hypothèses WPlace validées pour le lab

La documentation communautaire du protocole WPlace décrit des tuiles serveur de `1000×1000` pixels et un monde de `2048×2048` tuiles. Cela correspond au monde `2048000×2048000` et au zoom natif `11` observés dans l'application.

Ces valeurs restent regroupées dans l'adaptateur et les fonctions de géométrie afin de pouvoir les modifier si WPlace change son protocole.

## Objectif

Avant de brancher le Radar à D1, au cron Cloudflare ou aux alertes Discord, on valide séparément :

1. que le proxy fournit bien une tuile WPlace exploitable ;
2. que la réponse est un PNG valide ;
3. que les dimensions réelles de la tuile correspondent à ce que nous attendons ;
4. que le décodage donne des pixels fiables ;
5. que deux états peuvent être comparés efficacement ;
6. que les changements peuvent être regroupés en régions ;
7. que les régions peuvent être replacées dans le monde ;
8. que les coordonnées de zones peuvent être converties en tuiles ;
9. ensuite seulement, le cycle de vie des événements et la persistance D1.

## Test local facultatif

Depuis la racine du dépôt :

```bash
node radar/test-png-decoder.mjs
node radar/test-scan-core.mjs
node radar/test-tile-geometry.mjs
node radar/test-wplace-source.mjs
```

Le lab ne nécessite aucun paquet npm externe.

## Cache

Le endpoint utilisé par la carte et celui utilisé par le Radar doivent rester distincts :

- carte : cache long autorisé ;
- Radar : récupération fraîche nécessaire.

L'adaptateur utilise par défaut `/radar-tile/X/Y.png`. Ce chemin n'est pas encore activé sur le proxy de production : c'est volontaire.

Le proxy Radar devra désactiver le cache long pour ses sous-requêtes. Cloudflare permet de contrôler le TTL directement sur le `fetch()` d'une sous-requête, avec `cacheTtl: 0` pour une expiration immédiate.

## Prochaine étape

Le contrat est maintenant :

```text
/radar-tile/X/Y.png
        ↓
PNG decoder
        ↓
scan-core
        ↓
D1 event persistence
```

Il faut maintenant modifier le **proxy Cloudflare réel** pour ajouter ce chemin frais, puis tester une vraie tuile `1000×1000` avant de brancher le planificateur et le cycle toutes les 2 minutes.

## Sécurité de déploiement

Le lab n'active aucun Cron, aucune alerte Discord et aucune surveillance automatique. Le moteur restera en mode observation tant que le pipeline réel n'aura pas été validé.
