# Radar Lab

Laboratoire de validation du flux WPlace utilisé par le Radar.

## Objectif

Avant de brancher le Radar à D1, au cron Cloudflare ou aux alertes Discord, on valide séparément :

1. que le proxy fournit bien une tuile WPlace exploitable ;
2. que la réponse est un PNG valide ;
3. que les dimensions réelles de la tuile correspondent à ce que nous attendons ;
4. que les en-têtes de cache ne rendent pas un scan toutes les 2 minutes impossible ;
5. ensuite seulement, la lecture pixel par pixel et la détection de changements.

## Test local

Depuis la racine du dépôt :

```bash
node radar/tile-inspector.js
```

Le script ne modifie rien et ne dépend d'aucun paquet externe.

## Important

Le proxy actuellement utilisé par la carte possède un cache Cloudflare de longue durée. Ce comportement est utile pour les tuiles de carte, mais doit être vérifié avant de le réutiliser tel quel pour un Radar à intervalle de 2 minutes.
