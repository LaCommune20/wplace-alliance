# PR1 — Réalignement DEV / dépôt

## Objet

Cette phase réaligne le dépôt GitHub sur l'état réellement utilisé en Cloudflare DEV, sans modifier le comportement nominal du Worker.

## Inclus

- synchronisation du `CHECK` de `template_history` pour accepter `upload` ;
- ajout du schéma Radar actuellement utilisé en DEV ;
- intégration du Worker DEV complet comme source versionnée dans `worker/src/index.js` ;
- documentation du contrat Worker et des limites connues.

Le Worker est intégré comme snapshot vérifiable de l'état DEV. Cette PR ne cherche pas encore à le refactorer ni à séparer ses responsabilités.

## Hors scope

- déploiement Cloudflare ;
- PROD ;
- correction du scheduler ;
- budget de scan ;
- notifications ;
- refactor du moteur Radar ;
- changement du comportement nominal du scan.

## Point important

Le Worker DEV complet est désormais présent dans l'arborescence du dépôt sous `worker/src/index.js`. L'ancien placeholder historique `oauth-worker-next.js` n'est pas remplacé par cette PR : le nouveau source Worker est versionné séparément afin de conserver un historique clair et de permettre une vérification indépendante avant toute refactorisation.

L'intégration du Worker ne constitue donc pas une autorisation de déploiement. Cette PR ne déclenche aucun déploiement Cloudflare et ne modifie pas PROD.

## Suite

Après validation de ce réalignement :

1. séparer proprement les outils de test DEV du moteur de scan ;
2. corriger le scheduler et la politique de retry ;
3. ajouter le budget borné/priorisé ;
4. structurer les observations et la confirmation ;
5. raccorder les seuils et les notifications ;
6. seulement ensuite poursuivre le refactor du Worker en conservant des étapes vérifiables.
