# WPlace La Commune — Configuration Discord DEV des rôles

## Objectif

Préparer le serveur Discord DEV pour le modèle métier V1 sans encore modifier les permissions du Worker.

Cette étape est volontairement séparée de l'implémentation serveur : les rôles doivent d'abord exister et être identifiables de manière stable.

## Serveur Discord DEV

- `WPLACE LA COMMUNE` → `1544517835127128107`

## Rôles métier V1

Ordre de hiérarchie retenu :

1. Admin
2. Modérateur
3. Gérant de zone
4. Responsable des templates
5. Allié
6. Communard
7. Sympathisant
8. @everyone

`Neutre` n'est pas un rôle utilisateur Discord : c'est une classification métier des zones/affichages.

## IDs Discord DEV relevés

Les rôles métier ont maintenant été créés/vérifiés sur le serveur DEV et leurs IDs ont été relevés :

| Rôle | Discord role ID |
|---|---|
| Admin | `1544518579607699466` |
| Modérateur | `1544518813918433300` |
| Gérant de zone | `1548049796026339430` |
| Responsable des templates | `1548049949449523230` |
| Allié | `1548050034749341706` |
| Communard | `1548050120715538613` |
| Sympathisant | `1548050200344526928` |

Ces IDs sont des identifiants publics de rôles Discord et ne constituent pas des secrets. Ils pourront être utilisés dans la configuration Worker correspondante.

## Règles de création

- Créer les rôles avec exactement les noms métier ci-dessus.
- Ne pas utiliser le nom d'un rôle comme identifiant de sécurité dans le Worker.
- Le Worker doit utiliser les IDs Discord des rôles.
- Ne pas donner de permissions Discord d'administration aux rôles métier simplement pour leur permettre d'utiliser WPlace La Commune.
- Les permissions d'accès à l'application restent contrôlées côté Worker/D1.

## Variables d'environnement Worker

Le Worker utilise déjà deux variables d'environnement :

- `DISCORD_ADMIN_ROLE_ID`
- `DISCORD_MODERATOR_ROLE_ID`

Leur valeur reste hors Git et doit rester configurée dans Cloudflare.

Le modèle métier nécessite ensuite quatre nouvelles variables d'environnement :

- `DISCORD_ZONE_MANAGER_ROLE_ID`
- `DISCORD_TEMPLATE_MANAGER_ROLE_ID`
- `DISCORD_ALLY_ROLE_ID`
- `DISCORD_COMMUNARD_ROLE_ID`

Correspondance DEV prévue :

- `DISCORD_ADMIN_ROLE_ID` → `1544518579607699466`
- `DISCORD_MODERATOR_ROLE_ID` → `1544518813918433300`
- `DISCORD_ZONE_MANAGER_ROLE_ID` → `1548049796026339430`
- `DISCORD_TEMPLATE_MANAGER_ROLE_ID` → `1548049949449523230`
- `DISCORD_ALLY_ROLE_ID` → `1548050034749341706`
- `DISCORD_COMMUNARD_ROLE_ID` → `1548050120715538613`

Le rôle `Sympathisant` n'a pas besoin d'un ID pour les permissions d'administration : son absence de permission est le comportement par défaut. Il pourra néanmoins être utilisé plus tard pour des fonctionnalités métier spécifiques.

## Attribution des zones

Les rôles Discord métier ne doivent pas être interprétés comme une attribution automatique à toutes les zones.

La portée reste une donnée serveur :

- Modérateur → `zone_moderators`
- Gérant de zone → future attribution de zone dédiée
- Responsable des templates → `zone_staff` / `template_manager` dans l'état technique actuel
- Allié → future attribution de zone dédiée

Les rôles Discord indiquent donc le métier global du membre ; la base D1 détermine la zone réellement administrable.

## Correspondance métier → technique

| Rôle Discord | Portée | État technique cible |
|---|---|---|
| Admin | globale | `admin` |
| Modérateur | globale pour validation ; zone pour modification | `moderator` + `zone_moderators` |
| Gérant de zone | zone attribuée | future permission `zones_manage` + `boundaries_manage` + `notes_manage` |
| Responsable des templates | zone attribuée | `template_manager` + `templates_manage` |
| Allié | zone attribuée | future attribution + `templates_manage` + `notes_manage` |
| Communard | globale en consultation | `member` + permissions publiques/métier futures |
| Sympathisant | consultation | `member` / défaut |

## Important : état actuel du Worker

Le Worker reconnaît aujourd'hui directement les rôles Admin et Modérateur via leurs IDs, puis construit `session.access` en `admin`, `zone_admin`, `moderator` ou `member`.

Les rôles `manager` et `template_manager` ne doivent pas devenir des valeurs globales de `session.access`. Ils restent des affectations de zone utilisées par les helpers de permission.

## Ordre d'implémentation

1. Créer/vérifier les rôles dans Discord DEV. — fait
2. Relever leurs IDs. — fait
3. Ajouter les noms de variables d'environnement au Worker sans exposer leurs valeurs.
4. Ajouter une fonction serveur de lecture des rôles métier.
5. Faire évoluer les permissions une par une.
6. Tester avec des comptes Discord distincts.
7. Déployer uniquement le Worker DEV après avertissement explicite.
8. Ne préparer la PROD qu'après validation complète.

## Hors périmètre

- aucune modification des permissions du serveur Discord dans le code ;
- aucune migration D1 dans cette étape ;
- aucune implémentation Notes ;
- aucune implémentation Trouvailles ;
- aucune modification Radar/proxy ;
- aucun déploiement PROD.
