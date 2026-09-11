# WPlace La Commune — API Worker

## Phase 0 — réalignement

Le dépôt doit devenir la source versionnée du Worker DEV réellement utilisé par l'API.

Cette phase ne doit pas mélanger réalignement et refactorisation.

### Bindings attendus

- `DB`
- `RADAR_BUCKET`
- `TEMPLATES_BUCKET`
- `RADAR_PROXY`

### Cron DEV

```text
*/2 * * * *
```

Le Cron appelle `scheduled()` puis `runRadarScheduler()`.

### Secrets

Les secrets Discord/OAuth et autres variables sensibles ne sont pas committés.
Ils restent configurés dans Cloudflare.

### Rôles Discord DEV — Phase 2

Les IDs de rôles sont des identifiants publics et peuvent être documentés. Ils ne remplacent pas les contrôles d'autorisation côté Worker/D1.

Variables déjà utilisées :

- `DISCORD_ADMIN_ROLE_ID`
- `DISCORD_MODERATOR_ROLE_ID`

Variables métier préparées pour le modèle V1 :

- `DISCORD_ZONE_MANAGER_ROLE_ID`
- `DISCORD_TEMPLATE_MANAGER_ROLE_ID`
- `DISCORD_ALLY_ROLE_ID`
- `DISCORD_COMMUNARD_ROLE_ID`

Le rôle `Sympathisant` ne nécessite pas de variable de rôle pour les permissions d'administration : l'absence de permission est le comportement par défaut.

Les valeurs des variables d'environnement restent hors Git et doivent être configurées dans Cloudflare DEV.

La portée par zone reste déterminée côté Worker/D1 : un rôle Discord métier ne donne pas automatiquement accès à toutes les zones.

### Limites connues du Worker DEV

- `status: "failed"` peut actuellement être retourné avec HTTP 200 ;
- le claim avance `last_scan_at` avant le scan ;
- les seuils `alert_threshold` / `urgency_threshold` ne sont pas encore raccordés au scan automatique ;
- la chaîne de notification automatique n'est pas complète ;
- le scan est actuellement limité à 1000 tuiles ;
- certaines routes et options de test DEV existent encore.

Ces points sont volontairement hors scope du réalignement et devront faire l'objet de changements séparés.

### PROD

Aucun déploiement PROD ne doit être déclenché par cette phase.
