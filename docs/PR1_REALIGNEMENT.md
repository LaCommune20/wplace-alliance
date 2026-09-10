# PR1 — Réalignement DEV / dépôt

## Objet

Cette phase commence le réalignement entre le schéma réellement utilisé en DEV et le dépôt GitHub.

## Inclus

- synchronisation du `CHECK` de `template_history` pour accepter `upload` ;
- ajout du schéma Radar actuellement utilisé en DEV ;
- documentation du contrat Worker et des limites connues.

## Hors scope

- déploiement Cloudflare ;
- PROD ;
- correction du scheduler ;
- budget de scan ;
- notifications ;
- refactor du moteur Radar ;
- changement du comportement nominal du scan.

## Point important

Le Worker DEV complet existe actuellement hors de l'arborescence backend du dépôt. Cette PR ne remplace pas le placeholder historique `oauth-worker-next.js` par une copie partielle du Worker : le raccord du source Worker doit être effectué avec une intégration complète et vérifiable, dans une étape dédiée.

Cette décision évite de créer un dépôt contenant un faux point d'entrée ou un Worker incomplet.

## Suite

Après validation de la synchronisation SQL :

1. intégrer le Worker DEV complet comme source versionnée ;
2. séparer proprement les outils de test DEV ;
3. seulement ensuite corriger le scheduler ;
4. ajouter le budget borné/priorisé ;
5. observations, confirmation et notifications.
