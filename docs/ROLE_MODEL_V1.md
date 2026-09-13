# WPlace La Commune — Modèle des rôles Discord V1

## Statut

Phase 2 — modèle métier verrouillé le 11 septembre 2026.

Ce document fixe les règles métier avant toute extension du système d'autorisation.
Il ne constitue pas encore une implémentation technique complète.

## Rôles Discord

Ordre de hiérarchie retenu sur le serveur DEV :

1. Admin
2. Modérateur
3. Gérant de zone
4. Responsable des templates
5. Allié
6. Communard
7. Sympathisant
8. @everyone

`Neutre` n'est pas un rôle utilisateur Discord dans ce modèle. Il reste une classification métier des zones/affichages.

## Actions métier

- **Consulter** : lire les informations auxquelles le membre a accès.
- **Proposer** : créer une demande de modification ou une contribution sans modifier directement la ressource.
- **Modifier** : effectuer directement une modification autorisée.
- **Valider** : accepter/refuser une demande nécessitant une validation humaine.
- **Supprimer** : supprimer ou archiver une ressource selon les règles du module concerné.

## Matrice générale

| Rôle | Consulter | Proposer | Modifier directement | Valider | Supprimer |
|---|---:|---:|---|---:|---:|
| Sympathisant | Oui | Non | Non | Non | Non |
| Communard | Oui | Oui | Non | Non | Non |
| Allié | Oui | Oui | Templates + Notes de sa zone | Non | Non |
| Gérant de zone | Oui | Oui | Zone + frontières + Notes de sa zone | Non | Non |
| Responsable des templates | Oui | Oui | Templates de sa zone | Non | Non |
| Modérateur | Oui | Oui | Zones attribuées | Oui | Non |
| Admin | Oui | Oui | Tout | Oui | Oui |

## Portée

### Admin

Portée globale. L'Admin peut administrer toutes les zones et tous les modules qui lui sont ouverts.

### Modérateur

Le rôle donne le pouvoir de validation. La modification directe des zones est conditionnée à une attribution de zone.

- Modérateur avec zones attribuées : modification directe de ces zones + validation.
- Modérateur sans zone attribuée : principalement consultation, proposition et validation.

### Gérant de zone

La gestion est limitée aux zones qui lui sont attribuées.

Il peut modifier directement :

- les informations de sa zone ;
- les frontières de sa zone ;
- les Notes de sa zone.

### Responsable des templates

La gestion est limitée aux templates des zones qui lui sont attribuées.
Il ne reçoit pas de droit de modification des frontières ou des Notes par ce rôle seul.

### Allié

L'Allié conserve les droits du Communard et reçoit des droits supplémentaires sur sa zone :

- modification du template de sa zone ;
- modification des Notes de sa zone ;
- proposition de modifications de frontières de sa zone.

La modification directe des frontières n'est pas accordée par le rôle Allié.

### Communard

Le Communard peut consulter, proposer des modifications/demandes et télécharger les templates accessibles, mais ne modifie pas directement les ressources protégées.

### Sympathisant

Rôle de base. Consultation uniquement.

## Trouvailles

Une Trouvaille peut être proposée par les membres autorisés par le futur module.

La **validation d'une Trouvaille est réservée aux Modérateurs et aux Admins**.

Après validation, la publication sur la carte est effectuée par le système.

## Principe de sécurité

Les rôles Discord sont une source d'identité et de statut métier, mais le navigateur n'est jamais une frontière de sécurité.

Le Worker reste l'autorité d'autorisation côté serveur.

La portée par zone doit être vérifiée côté Worker/D1 à chaque action sensible.

## État technique existant

Le système actuel possède déjà :

- `admin` comme accès global ;
- `moderator` comme accès lié aux affectations `zone_moderators` pour les opérations de zone ;
- `zone_staff` avec `manager` et `template_manager` pour les permissions Notes/Templates ;
- `notes_manage` et `templates_manage` comme permissions de ressource ;
- `/api/admin/access` pour exposer au frontend les permissions de ressource calculées côté serveur.

Ces mécanismes ne doivent pas être supprimés ni contournés. La suite doit les faire évoluer progressivement vers le modèle métier V1.

## Points techniques à traiter dans les prochaines PR

1. Définir la correspondance entre les nouveaux rôles Discord et leurs IDs côté Worker.
2. Définir comment une attribution de zone est représentée pour `Gérant de zone`, `Responsable des templates` et `Allié`.
3. Étendre les permissions serveur de façon explicite, notamment pour les frontières et les Notes.
4. Permettre au Modérateur attribué à une zone de conserver la modification directe déjà prévue par le modèle.
5. Introduire les permissions de proposition et de validation uniquement lorsque les modules de demandes/Trouvailles existent réellement.
6. Ne pas transformer les rôles de zone en accès globaux de session.
7. Ne pas modifier le Radar, le proxy ou la logique OAuth2 dans cette phase.

## Hors périmètre de ce document

- création des tables supplémentaires ;
- migration D1 ;
- déploiement Worker ;
- configuration PROD ;
- implémentation des Notes ;
- implémentation des Trouvailles ;
- extension du Radar.
