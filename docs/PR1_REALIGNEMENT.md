# PR1 — Réalignement du backend

PR1 ajoute le premier backend Worker réellement versionné au dépôt.

## Scope

- versionner le Worker DEV actuellement validé ;
- ajouter les migrations de synchronisation du schéma ;
- documenter le périmètre et les limites connues ;
- ne pas modifier le comportement fonctionnel du Radar.

## Hors scope

- correction du scheduler ;
- budget de scan ;
- notifications ;
- refactor du moteur Radar ;
- WebSocket ;
- Durable Objects ;
- déploiement PROD.

Le Worker conserve volontairement les éléments de test DEV dans cette première PR afin d'éviter de mélanger réalignement et refactorisation.

## Vérifications

- `node --check worker/src/index.js` : PASS
- scan basique de secrets : PASS
- aucune modification de `0001`/`0002`
- aucune écriture Cloudflare effectuée par cette PR
