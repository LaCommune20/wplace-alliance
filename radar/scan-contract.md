# Radar — contrat de scan V1

Ce document fixe la séparation entre récupération WPlace, analyse locale et persistance.

## Pipeline

```text
WPlace tile
   ↓
Radar proxy frais
   ↓
PNG decoder
   ↓
RGBA8 tile
   ↓
compareTiles()
   ↓
findChangedRegions()
   ↓
scan metrics
   ↓
radar event lifecycle
   ↓
D1
   ↓
alert / Discord / map
```

## Ce que produit un scan

Pour chaque tuile examinée :

- `tile_x`, `tile_y`
- nombre de pixels modifiés
- nombre de pixels modifiés non transparents
- bounding box globale de la modification
- régions contiguës avec leur bounding box
- score brut de changement
- horodatage du scan

Aucun pixel individuel n'est écrit dans D1.

## Événement

Plusieurs scans peuvent appartenir au même événement si les régions restent proches dans l'espace et dans le temps. Le moteur d'événements décidera plus tard si une nouvelle détection :

- prolonge un événement actif ;
- réactive un événement silencieux ;
- crée un nouvel événement ;
- ou ne mérite pas d'être conservée.

## Classification allié / attaque

La première version ne déduit pas automatiquement qu'une modification est une attaque ou une défense.

La classification devra combiner :

1. présence d'un template connu ;
2. correspondance locale des couleurs/pixels ;
3. emplacement dans la zone ;
4. volume et forme de la modification ;
5. historique récent de l'événement ;
6. éventuellement les informations WPlace disponibles sur les pixels.

Un score de changement élevé n'est donc **pas** synonyme d'attaque.

## Cache

Le endpoint utilisé par la carte et celui utilisé par le Radar doivent rester distincts.

- carte : cache long autorisé ;
- Radar : récupération fraîche nécessaire.

Le moteur Radar ne doit jamais considérer une tuile issue d'un cache long comme une observation fiable à l'intervalle de 2 minutes.

## Cron

Le Cron Cloudflare sera ajouté seulement lorsque le pipeline de scan sera validé. L'intervalle cible est de 120 secondes.

## Mode observation

Le premier déploiement du moteur doit fonctionner en mode observation :

- pas d'alerte Discord automatique ;
- pas de notification utilisateur ;
- conservation des événements pour inspection ;
- mesures de temps et d'erreurs ;
- possibilité de désactiver un Radar sans supprimer ses données.
