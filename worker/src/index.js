async function runRadarScan(env, radarIdInput, options = {}) {
  const scanOptions = options && typeof options === "object" ? options : {};

  function radarScanResult(data, status = 200, _env = null) {
    return { data, status };
  }

        const radarId = String(radarIdInput || "").trim();
        const scanStartedAt = new Date().toISOString();
        let zoneId = scanOptions.zoneId == null ? null : Number(scanOptions.zoneId);
        let tiles = Array.isArray(scanOptions.tiles) && scanOptions.tiles.length ? scanOptions.tiles : null;
        let radarScope = null;

        // Real Radars are resolved from D1 when no explicit tile override is supplied.
        if (!tiles) {
          try {
            const runtime = await loadRadarRuntimeConfigInline(env.DB, radarId);
            zoneId = runtime.zone.id;
            tiles = runtime.scope.tiles;
            radarScope = runtime.scope;
            await updateRadarScanMetadata(env.DB, radarId, {
              last_scan_at: scanStartedAt,
              last_error_at: null
            });
          } catch (error) {
            return radarScanResult({ error: error instanceof Error ? error.message : String(error) }, 400, env);
          }
        } else {
          await updateRadarScanMetadata(env.DB, radarId, {
            last_scan_at: scanStartedAt,
            last_error_at: null
          });
        }

        if (!/^[A-Za-z0-9._:-]{1,120}$/.test(radarId)) {
          return radarScanResult({ error: "radar_id invalide" }, 400, env);
        }
        if (zoneId !== null && !Number.isInteger(zoneId)) {
          return radarScanResult({ error: "zone_id invalide" }, 400, env);
        }
        const maxConfiguredTiles = 1000;
        if (tiles.length < 1 || tiles.length > maxConfiguredTiles) {
          return radarScanResult({ error: `Entre 1 et ${maxConfiguredTiles} tuiles sont autorisées pour ce test` }, 400, env);
        }

        const normalizedTiles = [];
        const seenKeys = new Set();
        for (const tile of tiles) {
          const tileX = Number(tile?.tileX);
          const tileY = Number(tile?.tileY);
          if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0) {
            return radarScanResult({ error: "Coordonnée de tuile invalide" }, 400, env);
          }
          const key = radarTileKey(tileX, tileY);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          normalizedTiles.push({ tileX, tileY });
        }

        let candidate = null;
        try {
          const seenAt = new Date().toISOString();
          const current = await getRadarCurrentBaseline(env.DB, radarId);
          candidate = await createRadarCandidate(env, radarId, normalizedTiles);
          let events = await getRadarOpenEventsWithRegions(env.DB, radarId);

          // Expiration is deliberately separate from tile observations.
          // Transitions are kept in memory here and persisted once after the
          // baseline candidate has committed, alongside observation decisions.
          const expirations = resolveRadarEventExpirationsWorker(events, Date.parse(seenAt));
          for (const transition of expirations) {
            const index = events.findIndex(event => event.id === transition.event.id);
            if (index >= 0) events[index] = transition.event;
          }

          /** @type {Array<Record<string, any>>} */
          const results = [];
          let errorCount = 0;
          let changedTiles = 0;
          let createdEvents = 0;
          let updatedEvents = 0;
          const pendingEventDecisions = [];
          let temporaryEventId = -1;

          for (const tile of normalizedTiles) {
            const key = radarTileKey(tile.tileX, tile.tileY);
            try {

              const currentTile = typeof scanOptions.fetchTile === "function"
                ? await scanOptions.fetchTile(tile.tileX, tile.tileY)
                : await fetchRadarProxyTile(env, tile.tileX, tile.tileY);
              const previousObject = current
                ? await env.RADAR_BUCKET.get(radarCommittedTileKey(radarId, current.version, tile.tileX, tile.tileY))
                : null;
              const currentHash = await sha256Hex(currentTile.bytes);
              let previousHash = null;
              let analysis = null;

              if (previousObject?.body) {
                const previousBytes = new Uint8Array(await previousObject.arrayBuffer());
                previousHash = await sha256Hex(previousBytes);
                if (previousHash !== currentHash) {
                  const previousDecoded = await radarDecodePng(previousBytes.buffer);
                  const currentDecoded = await radarDecodePng(currentTile.bytes.buffer);
                  analysis = radarAnalyzeTileChange(previousDecoded, currentDecoded, {
                    minRegionPixels: Number(scanOptions.minRegionPixels ?? 2),
                    maxRegions: Number(scanOptions.maxRegions ?? 128)
                  });
                }
              }

              await putRadarCandidateTile(env, candidate, tile, currentTile.bytes);

              const result = {
                tileX: tile.tileX,
                tileY: tile.tileY,
                state: previousHash === null ? "baseline" : "scanned",
                changed: Boolean(analysis?.changed),
                severity: analysis?.severity || "none",
                score: analysis?.score ?? 0,
                summary: analysis?.summary || null,
                regions: analysis?.regions || [],
                currentHash,
                previousHash,
                error: null
              };
              results.push(result);

              if (analysis?.changed) {
                changedTiles += 1;
                const incomingRegions = analysis.regions.map(region => ({
                  tile_x: tile.tileX,
                  tile_y: tile.tileY,
                  min_x: region.minX,
                  min_y: region.minY,
                  max_x: region.maxX,
                  max_y: region.maxY,
                  pixel_count: region.pixelCount
                }));
                const observation = {
                  changed: true,
                  score: analysis.score,
                  summary: analysis.summary,
                  regions: incomingRegions
                };
                const groups = radarGroupRegionsByProximity(
                  incomingRegions,
                  RADAR_EVENT_PROXIMITY_PIXELS
                );
                const groupDecisions = [];

                for (const group of groups) {
                  const groupObservation = radarObservationForRegionGroup(observation, group);
                  const decision = resolveRadarObservationWorker({
                    radarId,
                    zoneId,
                    observation: groupObservation,
                    events,
                    now: Date.parse(seenAt)
                  });

                  if (decision.action === "create") {
                    createdEvents += 1;
                    decision.event.id = temporaryEventId--;
                    decision.event.regions = group;
                    events.push(decision.event);
                  } else if (decision.action === "update") {
                    updatedEvents += 1;
                    const eventIndex = events.findIndex(event => event.id === decision.event.id);
                    if (eventIndex >= 0) {
                      events[eventIndex] = {
                        ...decision.event,
                        regions: [...(events[eventIndex].regions || []), ...group]
                      };
                    }
                  }

                  groupDecisions.push(decision);
                  pendingEventDecisions.push(decision);
                }

                result.event_actions = groupDecisions.map(decision => decision.action);
                result.event_ids = groupDecisions.map(decision => decision.event?.id ?? null);
                // Keep the old scalar fields for compatibility when an observation
                // contains exactly one spatial group.
                if (groupDecisions.length === 1) {
                  result.event_action = groupDecisions[0].action;
                  result.event_id = groupDecisions[0].event?.id ?? null;
                }
              }
            } catch (error) {
              errorCount += 1;
              results.push({
                tileX: tile.tileX,
                tileY: tile.tileY,
                state: "error",
                changed: false,
                severity: "none",
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }

          if (errorCount > 0) {
            await abortRadarCandidate(env, candidate);
            await updateRadarScanMetadata(env.DB, radarId, {
              last_error_at: new Date().toISOString()
            });
            return radarScanResult({
              ok: true,
              status: "failed",
              radar_id: radarId,
              requested_tiles: normalizedTiles.length,
              successful_tiles: normalizedTiles.length - errorCount,
              error_tiles: errorCount,
              changed_tiles: changedTiles,
              created_events: createdEvents,
              updated_events: updatedEvents,
              baseline_preserved: true,
              results
            }, 200, env);
          }

          await finalizeRadarCandidate(env, candidate);
          const committed = await commitRadarCandidate(env, candidate);

          // Event writes happen only after the complete baseline candidate has
          // committed. This preserves the existing all-or-nothing baseline
          // invariant when a tile scan fails.
          let persistedEventActions = 0;
          const temporaryToPersisted = new Map();
          try {
            for (const decision of pendingEventDecisions) {
              if (decision.action === "create") {
                const temporaryId = decision.event.id;
                const persistedId = await persistRadarEventDecision(env, decision);
                temporaryToPersisted.set(temporaryId, persistedId);
                decision.event.id = persistedId;
                persistedEventActions += 1;
              } else if (decision.action === "update") {
                if (temporaryToPersisted.has(decision.event.id)) {
                  decision.event.id = temporaryToPersisted.get(decision.event.id);
                }
                await persistRadarEventDecision(env, decision);
                persistedEventActions += 1;
              }
            }
            for (const transition of expirations) {
              const revived = pendingEventDecisions.some(
                decision => decision.action === "update" && decision.event?.id === transition.event.id
              );
              if (revived) continue;
              await persistRadarEventDecision(env, transition);
              persistedEventActions += 1;
            }
            for (const result of results) {
              if (temporaryToPersisted.has(result.event_id)) {
                result.event_id = temporaryToPersisted.get(result.event_id);
              }
              if (Array.isArray(result.event_ids)) {
                result.event_ids = result.event_ids.map(eventId =>
                  temporaryToPersisted.has(eventId)
                    ? temporaryToPersisted.get(eventId)
                    : eventId
                );
              }
            }
          } catch (eventError) {
            console.error("Radar event persistence error after baseline commit:", eventError);
            await updateRadarScanMetadata(env.DB, radarId, {
              last_error_at: new Date().toISOString()
            });
            return radarScanResult({
              ok: true,
              status: "committed_with_event_error",
              radar_id: radarId,
              zone_id: zoneId,
              requested_tiles: normalizedTiles.length,
              error_tiles: 0,
              changed_tiles: changedTiles,
              created_events: createdEvents,
              updated_events: updatedEvents,
              expired_events: expirations.length,
              persisted_event_actions: persistedEventActions,
              event_error: String(eventError?.message || eventError),
              baseline: committed,
              results
            }, 200, env);
          }

          await updateRadarScanMetadata(env.DB, radarId, {
            last_success_at: new Date().toISOString(),
            last_error_at: null
          });

          return radarScanResult({
            ok: true,
            status: "committed",
            radar_id: radarId,
            zone_id: zoneId,
            scope_type: radarScope?.type || null,
            requested_tiles: normalizedTiles.length,
            error_tiles: 0,
            changed_tiles: changedTiles,
            created_events: createdEvents,
            updated_events: updatedEvents,
            expired_events: expirations.length,
            persisted_event_actions: persistedEventActions,
            baseline: committed,
            results
          }, 200, env);
        } catch (error) {
          if (candidate) {
            try { await abortRadarCandidate(env, candidate); } catch (cleanupError) {
              console.error("Radar candidate cleanup error:", cleanupError);
            }
          }
          console.error("Radar event lifecycle test error:", error);
          return radarScanResult({
            error: "Échec du test Radar",
            detail: String(error?.message || error)
          }, 500, env);
        }
}


async function claimRadarScanSlot(db, radarId, expectedLastScanAt, claimedAt) {
  if (!db || !radarId || !claimedAt) return false;

  const result = await db.prepare(`
    UPDATE radars
    SET last_scan_at = ?, last_error_at = NULL
    WHERE id = ?
      AND status = 'active'
      AND (
        (last_scan_at IS NULL AND ? IS NULL)
        OR last_scan_at = ?
      )
  `).bind(
    claimedAt,
    radarId,
    expectedLastScanAt ?? null,
    expectedLastScanAt ?? null
  ).run();

  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return changes === 1;
}

async function runRadarScheduler(env, now = Date.now()) {
  if (!env?.DB) {
    return {
      ok: false,
      scanned: 0,
      skipped: 0,
      failed: 0,
      error: "DB indisponible"
    };
  }

  const startedAt = new Date(now).toISOString();
  let radars = [];

  try {
    const { results = [] } = await env.DB.prepare(`
      SELECT
        id,
        status,
        scan_interval_seconds,
        last_scan_at
      FROM radars
      WHERE status = 'active'
      ORDER BY id ASC
    `).all();
    radars = results;
  } catch (error) {
    console.error("Radar scheduler D1 query error:", error);
    return {
      ok: false,
      scanned: 0,
      skipped: 0,
      failed: 0,
      error: String(error?.message || error)
    };
  }

  const dueRadars = [];
  for (const radar of radars) {
    const due = isRadarScanDue(radar, now);
    if (due.due) {
      dueRadars.push({ radar, due });
    }
  }

  const results = [];
  let scanned = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of dueRadars) {
    const radar = item.radar;
    const claimedAt = new Date().toISOString();

    try {
      const claimed = await claimRadarScanSlot(
        env.DB,
        radar.id,
        radar.last_scan_at,
        claimedAt
      );

      if (!claimed) {
        skipped += 1;
        results.push({
          radar_id: radar.id,
          status: "skipped",
          reason: "scan_claim_lost"
        });
        continue;
      }

      const scan = await runRadarScan(env, radar.id);
      scanned += 1;
      if (Number(scan?.status) >= 400) failed += 1;

      results.push({
        radar_id: radar.id,
        status: scan?.data?.status || "unknown",
        http_status: scan?.status ?? 500,
        requested_tiles: scan?.data?.requested_tiles ?? null,
        error_tiles: scan?.data?.error_tiles ?? null,
        changed_tiles: scan?.data?.changed_tiles ?? null,
        created_events: scan?.data?.created_events ?? null,
        updated_events: scan?.data?.updated_events ?? null,
        expired_events: scan?.data?.expired_events ?? null
      });
    } catch (error) {
      failed += 1;
      console.error(`Radar scheduler scan error (${radar.id}):`, error);
      results.push({
        radar_id: radar.id,
        status: "failed",
        reason: String(error?.message || error)
      });
    }
  }

  return {
    ok: failed === 0,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    active_radars: radars.length,
    due_radars: dueRadars.length,
    scanned,
    skipped,
    failed,
    results
  };
}


export default {
  async scheduled(controller, env) {
    const now = Number.isFinite(Number(controller?.scheduledTime))
      ? Number(controller.scheduledTime)
      : Date.now();

    const result = await runRadarScheduler(env, now);
    console.log("Radar scheduler run:", JSON.stringify(result));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return corsPreflight(request, env);
    }

    // ------------------------------------------------------------
    // AUTHENTIFICATION DISCORD
    // ------------------------------------------------------------

    if (url.pathname === "/auth/discord" && request.method === "GET") {
      return startDiscordOAuth(request, env);
    }

    if (url.pathname === "/auth/discord/callback" && request.method === "GET") {
      return handleDiscordOAuthCallback(request, env);
    }

    if (url.pathname === "/api/auth/exchange" && request.method === "POST") {
      return exchangeAuthCode(request, env);
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const session = await getSession(request, env);

      if (!session) {
        return jsonAuth(request, { authenticated: false }, 401, env);
      }

      return jsonAuth(request, {
        authenticated: true,
        user: session.user,
        access: session.access,
        guild_id: env.DISCORD_GUILD_ID,
        expires_at: session.exp
      }, 200, env);
    }


    // ------------------------------------------------------------
    // API DEV — accueil
    // ------------------------------------------------------------

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("WPlace La Commune API — DEV", {
        headers: {
          "Content-Type": "text/plain; charset=UTF-8"
        }
      });
    }

    // ------------------------------------------------------------
    // CATEGORIES
    // ------------------------------------------------------------

    if (url.pathname === "/api/categories" && request.method === "GET") {
      const session = await requireMember(request, env);
      if (!session) return jsonAuth(request, { error: "Authentification requise" }, 401, env);

      try {
        const { results } = await env.DB
          .prepare(`
            SELECT
              id,
              slug,
              name,
              description,
              color,
              active,
              sort_order
            FROM categories
            WHERE active = 1
            ORDER BY sort_order ASC
          `)
          .all();

        return jsonAuth(request, results, 200, env);
      } catch (error) {
        console.error("Erreur D1 /categories:", error);
        return json(
          { error: "Erreur lors de la lecture des catégories" },
          500
        );
      }
    }

    // ------------------------------------------------------------
    // ZONES
    // ------------------------------------------------------------

    if (url.pathname === "/api/zones" && request.method === "GET") {
      const session = await requireMember(request, env);
      if (!session) return jsonAuth(request, { error: "Authentification requise" }, 401, env);

      try {
        const { results } = await env.DB
          .prepare(`
            SELECT
              z.id,
              z.slug,
              z.name,
              z.description,
              z.continent,
              z.country,
              z.owner_name,
              z.owner_public,
              z.polygon,
              z.status,
              z.version,
              z.created_at,
              z.updated_at,
              z.center,
              z.focus_zoom,
              c.id AS category_id,
              c.slug AS category_slug,
              c.name AS category_name,
              c.color AS category_color
            FROM zones z
            INNER JOIN categories c
              ON c.id = z.category_id
            WHERE z.status = 'active'
              AND c.active = 1
            ORDER BY
              c.sort_order ASC,
              z.name ASC
          `)
          .all();

        return jsonAuth(request, results, 200, env);
      } catch (error) {
        console.error("Erreur D1 /zones:", error);
        return json(
          { error: "Erreur lors de la lecture des zones" },
          500
        );
      }
    }

    // ------------------------------------------------------------
    // TEMPLATES D'UNE ZONE
    // ------------------------------------------------------------

    const templatesMatch = url.pathname.match(
      /^\/api\/zones\/([^/]+)\/templates$/
    );

    if (templatesMatch && request.method === "GET") {
      const session = await requireMember(request, env);
      if (!session) return jsonAuth(request, { error: "Authentification requise" }, 401, env);

      const zoneId = decodeURIComponent(templatesMatch[1]);

      try {
        const { results } = await env.DB
          .prepare(`
            SELECT
              t.id,
              t.zone_id,
              t.slug,
              t.name,
              t.description,
              t.wplace_url,
              t.status,
              t.version,
              t.created_at,
              t.updated_at
            FROM templates t
            INNER JOIN zones z
              ON z.id = t.zone_id
            WHERE
              (CAST(z.id AS TEXT) = ? OR z.slug = ?)
              AND z.status = 'active'
              AND t.status = 'active'
            ORDER BY
              t.name ASC,
              t.version DESC
          `)
          .bind(zoneId, zoneId)
          .all();

        return jsonAuth(request, results, 200, env);
      } catch (error) {
        console.error("Erreur D1 /templates:", error);
        return json(
          { error: "Erreur lors de la lecture des templates" },
          500
        );
      }
    }

    // ------------------------------------------------------------
    // TÉLÉCHARGEMENT PUBLIC D'UN TEMPLATE .WPLACE
    // ------------------------------------------------------------
    //
    // Le bucket R2 reste privé : aucun accès direct au bucket n'est
    // exposé au navigateur. Le Worker vérifie d'abord la session,
    // la zone, le template et l'état actif, puis lit l'objet R2.
    // ------------------------------------------------------------

    const templateDownloadMatch = url.pathname.match(
      /^\/api\/zones\/([^/]+)\/templates\/([^/]+)\/download$/
    );

    if (templateDownloadMatch && request.method === "GET") {
      const session = await requireMember(request, env);
      if (!session) {
        return jsonAuth(
          request,
          { error: "Authentification requise" },
          401,
          env
        );
      }

      const zoneRef = decodeURIComponent(templateDownloadMatch[1]);
      const templateRef = decodeURIComponent(templateDownloadMatch[2]);

      try {
        const template = await env.DB.prepare(`
          SELECT
            t.id,
            t.zone_id,
            t.slug,
            t.name,
            t.r2_key,
            t.status AS template_status,
            z.slug AS zone_slug,
            z.status AS zone_status
          FROM templates t
          INNER JOIN zones z
            ON z.id = t.zone_id
          WHERE
            (CAST(z.id AS TEXT) = ? OR z.slug = ?)
            AND (CAST(t.id AS TEXT) = ? OR t.slug = ?)
            AND z.status = 'active'
            AND t.status = 'active'
          LIMIT 1
        `)
          .bind(zoneRef, zoneRef, templateRef, templateRef)
          .first();

        if (!template) {
          return jsonAuth(
            request,
            { error: "Template introuvable ou indisponible" },
            404,
            env
          );
        }

        if (
          !template.r2_key ||
          template.r2_key.startsWith("templates/pending/")
        ) {
          return jsonAuth(
            request,
            { error: "Fichier .wplace indisponible pour ce template" },
            404,
            env
          );
        }

        if (!env.TEMPLATES_BUCKET) {
          console.error("Binding TEMPLATES_BUCKET manquant");
          return jsonAuth(
            request,
            { error: "Stockage des templates indisponible" },
            500,
            env
          );
        }

        const object = await env.TEMPLATES_BUCKET.get(template.r2_key);

        if (!object) {
          console.error(
            "Objet R2 introuvable pour le template:",
            template.id,
            template.r2_key
          );
          return jsonAuth(
            request,
            { error: "Fichier .wplace introuvable dans le stockage" },
            404,
            env
          );
        }

        const customMetadata = object.customMetadata || {};
        const rawFilename =
          customMetadata.filename || `${template.slug || "template"}.wplace`;

        const safeFilename = String(rawFilename)
          .replace(/[\\/\r\n\"<>:|?*\x00-\x1F]/g, "_")
          .replace(/\.wplace$/i, "")
          .slice(0, 200) + ".wplace";

        const asciiFallback = safeFilename
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^A-Za-z0-9._-]/g, "_")
          .slice(0, 200) || "template.wplace";

        const encodedFilename = encodeURIComponent(safeFilename);
        const headers = new Headers();
        headers.set(
          "Content-Type",
          object.httpMetadata?.contentType || "application/octet-stream"
        );
        headers.set(
          "Content-Disposition",
          `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`
        );
        headers.set("Cache-Control", "private, no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Vary", "Origin");

        if (object.size != null) {
          headers.set("Content-Length", String(object.size));
        }
        if (object.httpEtag) {
          headers.set("ETag", object.httpEtag);
        }

        const origin = request.headers.get("Origin");
        const allowedOrigin = getFrontendOrigin(env);
        if (origin === allowedOrigin) {
          headers.set("Access-Control-Allow-Origin", allowedOrigin);
          headers.set("Access-Control-Allow-Credentials", "true");
        }

        return new Response(object.body, {
          status: 200,
          headers
        });
      } catch (error) {
        console.error(
          "Erreur R2 /api/zones/:zone/templates/:template/download:",
          error
        );
        return jsonAuth(
          request,
          { error: "Impossible de télécharger le fichier .wplace" },
          500,
          env
        );
      }
    }

    // ------------------------------------------------------------
    // ADMINISTRATION — VUE D'ENSEMBLE
    // ------------------------------------------------------------

    if (url.pathname === "/api/admin/overview" && request.method === "GET") {
      const session = await requireAdminOrModerator(request, env);
      if (!session || !["admin", "moderator"].includes(session.access)) {
        return jsonAuth(request, { error: "Accès administrateur requis" }, 403, env);
      }

      try {
        const [zones, templates, operations, alerts] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS count FROM zones WHERE status = 'active'").first(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM templates WHERE status = 'active'").first(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM operations WHERE status IN ('planned','active')").first(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM alerts WHERE status != 'resolved'").first()
        ]);

        return jsonAuth(request, {
          access: session.access,
          counts: {
            zones: Number(zones?.count || 0),
            templates: Number(templates?.count || 0),
            operations: Number(operations?.count || 0),
            alerts: Number(alerts?.count || 0)
          }
        }, 200, env);
      } catch (error) {
        console.error("Erreur D1 /admin/overview:", error);
        return jsonAuth(request, { error: "Erreur lors de la lecture de l'administration" }, 500, env);
      }
    }

// WPlace La Commune — routes Worker pour la gestion des templates (sans R2)
// À insérer avant les routes d'administration des zones.
// R2 n'est volontairement pas utilisé ici : r2_key est réservé au futur upload.

// ------------------------------------------------------------
// ADMINISTRATION — TEMPLATES
// ------------------------------------------------------------

const adminTemplateIdMatch = url.pathname.match(/^\/api\/admin\/templates\/(\d+)$/);
const adminTemplateUploadMatch = url.pathname.match(/^\/api\/admin\/templates\/(\d+)\/upload$/);

if (url.pathname === "/api/admin/templates" && request.method === "GET") {
  const session = await requireAdminOrModerator(request, env);
  if (!session) return jsonAuth(request, { error: "Accès administrateur requis" }, 403, env);

  try {
    const sql = session.access === "admin" ? `
      SELECT t.id, t.zone_id, z.slug AS zone_slug, z.name AS zone_name,
             t.slug, t.name, t.description, t.r2_key, t.wplace_url,
             t.status, t.version, t.created_by, t.updated_by,
             t.created_at, t.updated_at
      FROM templates t
      INNER JOIN zones z ON z.id = t.zone_id
      ORDER BY z.name ASC, t.name ASC, t.version DESC
    ` : `
      SELECT t.id, t.zone_id, z.slug AS zone_slug, z.name AS zone_name,
             t.slug, t.name, t.description, t.r2_key, t.wplace_url,
             t.status, t.version, t.created_by, t.updated_by,
             t.created_at, t.updated_at
      FROM templates t
      INNER JOIN zones z ON z.id = t.zone_id
      INNER JOIN zone_moderators mine
        ON mine.zone_id = z.id AND mine.discord_user_id = ?
      ORDER BY z.name ASC, t.name ASC, t.version DESC
    `;
    const result = session.access === "admin"
      ? await env.DB.prepare(sql).all()
      : await env.DB.prepare(sql).bind(session.user.id).all();
    return jsonAuth(request, result?.results || [], 200, env);
  } catch (error) {
    console.error("Erreur D1 /api/admin/templates GET:", error);
    return jsonAuth(request, { error: "Erreur lors de la lecture des templates" }, 500, env);
  }
}

if (url.pathname === "/api/admin/templates" && request.method === "POST") {
  const session = await requireAdminOrModerator(request, env);
  if (!session) return jsonAuth(request, { error: "Accès administrateur requis" }, 403, env);

  let body;
  try { body = await request.json(); }
  catch { return jsonAuth(request, { error: "Requête JSON invalide" }, 400, env); }

  const zoneId = Number(body?.zone_id);
  const slug = String(body?.slug || "").trim().toLowerCase();
  const name = String(body?.name || "").trim();
  const description = body?.description == null ? null : String(body.description).trim();
  const wplaceUrl = body?.wplace_url == null ? null : String(body.wplace_url).trim();
  const status = body?.status == null ? "pending" : String(body.status);

  if (!Number.isInteger(zoneId) || zoneId <= 0) return jsonAuth(request, { error: "Zone invalide" }, 400, env);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return jsonAuth(request, { error: "Slug de template invalide" }, 400, env);
  if (!name || name.length > 160) return jsonAuth(request, { error: "Nom de template invalide" }, 400, env);
  if (description && description.length > 2000) return jsonAuth(request, { error: "Description trop longue" }, 400, env);
  if (wplaceUrl && wplaceUrl.length > 2000) return jsonAuth(request, { error: "URL WPlace trop longue" }, 400, env);
  if (!["pending", "active", "archived", "rejected"].includes(status)) return jsonAuth(request, { error: "Statut invalide" }, 400, env);

  try {
    const zone = await env.DB.prepare("SELECT id, slug, name, status FROM zones WHERE id = ? LIMIT 1").bind(zoneId).first();
    if (!zone) return jsonAuth(request, { error: "Zone introuvable" }, 404, env);
    if (zone.status !== "active") return jsonAuth(request, { error: "La zone doit être active" }, 400, env);

    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`SELECT 1 FROM zone_moderators WHERE zone_id = ? AND discord_user_id = ? LIMIT 1`)
        .bind(zoneId, session.user.id).first();
      if (!assigned) {
        await writeAdminLog(env, session.user.id, "template_create", "zone", zoneId, "denied", "Zone non attribuée");
        return jsonAuth(request, { error: "Cette zone ne vous est pas attribuée" }, 403, env);
      }
    }

    const conflict = await env.DB.prepare("SELECT id FROM templates WHERE zone_id = ? AND slug = ? LIMIT 1")
      .bind(zoneId, slug).first();
    if (conflict) return jsonAuth(request, { error: "Ce slug de template est déjà utilisé dans cette zone" }, 409, env);

    // Placeholder unique : il sera remplacé par la vraie clé R2 lors de l'upload.
    const r2Key = `templates/pending/${crypto.randomUUID()}.wplace`;
    const now = new Date().toISOString();
    const snapshot = {
      zone_id: zoneId, slug, name, description, r2_key: r2Key,
      wplace_url: wplaceUrl, status, version: 1
    };

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO templates
          (zone_id, slug, name, description, r2_key, wplace_url, status, version, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).bind(zoneId, slug, name, description, r2Key, wplaceUrl, status, session.user.id, session.user.id, now, now),
      env.DB.prepare(`
        INSERT INTO template_history
          (template_id, version, action, r2_key, snapshot, author_discord_id, created_at)
        VALUES (last_insert_rowid(), 1, 'create', ?, ?, ?, ?)
      `).bind(r2Key, JSON.stringify(snapshot), session.user.id, now)
    ]);

    const created = await env.DB.prepare(`
      SELECT t.id, t.zone_id, z.slug AS zone_slug, z.name AS zone_name,
             t.slug, t.name, t.description, t.r2_key, t.wplace_url,
             t.status, t.version, t.created_by, t.updated_by,
             t.created_at, t.updated_at
      FROM templates t INNER JOIN zones z ON z.id=t.zone_id
      WHERE t.zone_id=? AND t.slug=? LIMIT 1
    `).bind(zoneId, slug).first();

    await writeAdminLog(env, session.user.id, "template_create", "template", created?.id || null, "success", "Template créé", { zone_id: zoneId, version: 1 });
    return jsonAuth(request, { ok: true, template: created }, 201, env);
  } catch (error) {
    console.error("Erreur D1 /api/admin/templates POST:", error);
    await writeAdminLog(env, session.user.id, "template_create", "zone", zoneId || null, "error", "Échec de création du template", { message: String(error?.message || error) });
    return jsonAuth(request, { error: "Impossible de créer le template" }, 500, env);
  }
}

if (adminTemplateIdMatch && request.method === "GET") {
  const session = await requireAdminOrModerator(request, env);
  if (!session) return jsonAuth(request, { error: "Accès administrateur requis" }, 403, env);
  const templateId = Number(adminTemplateIdMatch[1]);
  try {
    const template = await env.DB.prepare(`
      SELECT t.id, t.zone_id, z.slug AS zone_slug, z.name AS zone_name,
             t.slug, t.name, t.description, t.r2_key, t.wplace_url,
             t.status, t.version, t.created_by, t.updated_by,
             t.created_at, t.updated_at
      FROM templates t INNER JOIN zones z ON z.id=t.zone_id
      WHERE t.id=? LIMIT 1
    `).bind(templateId).first();
    if (!template) return jsonAuth(request, { error: "Template introuvable" }, 404, env);
    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`SELECT 1 FROM zone_moderators WHERE zone_id=? AND discord_user_id=? LIMIT 1`)
        .bind(template.zone_id, session.user.id).first();
      if (!assigned) return jsonAuth(request, { error: "Template non autorisé" }, 403, env);
    }
    return jsonAuth(request, template, 200, env);
  } catch (error) {
    console.error("Erreur D1 template GET:", error);
    return jsonAuth(request, { error: "Erreur lors de la lecture du template" }, 500, env);
  }
}

if (adminTemplateIdMatch && ["PATCH", "PUT"].includes(request.method)) {
  const session = await requireAdminOrModerator(request, env);
  if (!session) return jsonAuth(request, { error: "Accès administrateur requis" }, 403, env);
  const templateId = Number(adminTemplateIdMatch[1]);

  let body;
  try { body = await request.json(); }
  catch { return jsonAuth(request, { error: "Requête JSON invalide" }, 400, env); }

  try {
    const current = await env.DB.prepare("SELECT * FROM templates WHERE id=? LIMIT 1").bind(templateId).first();
    if (!current) return jsonAuth(request, { error: "Template introuvable" }, 404, env);

    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`SELECT 1 FROM zone_moderators WHERE zone_id=? AND discord_user_id=? LIMIT 1`)
        .bind(current.zone_id, session.user.id).first();
      if (!assigned) {
        await writeAdminLog(env, session.user.id, "template_update", "template", templateId, "denied", "Zone non attribuée");
        return jsonAuth(request, { error: "Cette zone ne vous est pas attribuée" }, 403, env);
      }
    }

    const slug = Object.prototype.hasOwnProperty.call(body, "slug") ? String(body.slug || "").trim().toLowerCase() : current.slug;
    const name = Object.prototype.hasOwnProperty.call(body, "name") ? String(body.name || "").trim() : current.name;
    const description = Object.prototype.hasOwnProperty.call(body, "description") ? (body.description == null ? null : String(body.description).trim()) : current.description;
    const wplaceUrl = Object.prototype.hasOwnProperty.call(body, "wplace_url") ? (body.wplace_url == null ? null : String(body.wplace_url).trim()) : current.wplace_url;
    const status = Object.prototype.hasOwnProperty.call(body, "status") ? String(body.status) : current.status;

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return jsonAuth(request, { error: "Slug de template invalide" }, 400, env);
    if (!name || name.length > 160) return jsonAuth(request, { error: "Nom de template invalide" }, 400, env);
    if (description && description.length > 2000) return jsonAuth(request, { error: "Description trop longue" }, 400, env);
    if (wplaceUrl && wplaceUrl.length > 2000) return jsonAuth(request, { error: "URL WPlace trop longue" }, 400, env);
    if (!["pending", "active", "archived", "rejected"].includes(status)) return jsonAuth(request, { error: "Statut invalide" }, 400, env);

    const conflict = await env.DB.prepare("SELECT id FROM templates WHERE zone_id=? AND slug=? AND id!=? LIMIT 1")
      .bind(current.zone_id, slug, templateId).first();
    if (conflict) return jsonAuth(request, { error: "Ce slug de template est déjà utilisé dans cette zone" }, 409, env);

    const newVersion = Number(current.version || 1) + 1;
    const now = new Date().toISOString();
    const snapshot = { zone_id: current.zone_id, slug, name, description, r2_key: current.r2_key, wplace_url: wplaceUrl, status, version: newVersion };
    const action = status === "archived" && current.status !== "archived" ? "archive" : status === "active" && current.status === "archived" ? "restore" : "update";

    await env.DB.batch([
      env.DB.prepare(`UPDATE templates SET slug=?, name=?, description=?, wplace_url=?, status=?, version=?, updated_by=?, updated_at=? WHERE id=?`)
        .bind(slug, name, description, wplaceUrl, status, newVersion, session.user.id, now, templateId),
      env.DB.prepare(`INSERT INTO template_history (template_id, version, action, r2_key, snapshot, author_discord_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(templateId, newVersion, action, current.r2_key, JSON.stringify(snapshot), session.user.id, now)
    ]);

    const updated = await env.DB.prepare(`
      SELECT t.id, t.zone_id, z.slug AS zone_slug, z.name AS zone_name,
             t.slug, t.name, t.description, t.r2_key, t.wplace_url,
             t.status, t.version, t.created_by, t.updated_by,
             t.created_at, t.updated_at
      FROM templates t INNER JOIN zones z ON z.id=t.zone_id WHERE t.id=? LIMIT 1
    `).bind(templateId).first();
    await writeAdminLog(env, session.user.id, "template_update", "template", templateId, "success", "Template mis à jour", { version: newVersion, action });
    return jsonAuth(request, { ok: true, template: updated }, 200, env);
  } catch (error) {
    console.error("Erreur D1 template PATCH:", error);
    await writeAdminLog(env, session.user.id, "template_update", "template", templateId, "error", "Échec de mise à jour", { message: String(error?.message || error) });
    return jsonAuth(request, { error: "Impossible d'enregistrer le template" }, 500, env);
  }
}

// DELETE = archivage logique : aucune suppression physique pour conserver l'historique.
if (adminTemplateIdMatch && request.method === "DELETE") {
  const session = await requireAdminOrModerator(request, env);
  if (!session) return jsonAuth(request, { error: "Accès administrateur requis" }, 403, env);
  const templateId = Number(adminTemplateIdMatch[1]);
  try {
    const current = await env.DB.prepare("SELECT * FROM templates WHERE id=? LIMIT 1").bind(templateId).first();
    if (!current) return jsonAuth(request, { error: "Template introuvable" }, 404, env);
    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`SELECT 1 FROM zone_moderators WHERE zone_id=? AND discord_user_id=? LIMIT 1`)
        .bind(current.zone_id, session.user.id).first();
      if (!assigned) return jsonAuth(request, { error: "Cette zone ne vous est pas attribuée" }, 403, env);
    }
    if (current.status === "archived") return jsonAuth(request, { ok: true, archived: true }, 200, env);

    const newVersion = Number(current.version || 1) + 1;
    const now = new Date().toISOString();
    const snapshot = { zone_id: current.zone_id, slug: current.slug, name: current.name, description: current.description, r2_key: current.r2_key, wplace_url: current.wplace_url, status: "archived", version: newVersion };
    await env.DB.batch([
      env.DB.prepare("UPDATE templates SET status='archived', version=?, updated_by=?, updated_at=? WHERE id=?").bind(newVersion, session.user.id, now, templateId),
      env.DB.prepare("INSERT INTO template_history (template_id, version, action, r2_key, snapshot, author_discord_id, created_at) VALUES (?, ?, 'archive', ?, ?, ?, ?)").bind(templateId, newVersion, current.r2_key, JSON.stringify(snapshot), session.user.id, now)
    ]);
    await writeAdminLog(env, session.user.id, "template_archive", "template", templateId, "success", "Template archivé", { version: newVersion });
    return jsonAuth(request, { ok: true, archived: true, version: newVersion }, 200, env);
  } catch (error) {
    console.error("Erreur D1 template DELETE/archive:", error);
    return jsonAuth(request, { error: "Impossible d'archiver le template" }, 500, env);
  }
}



// ------------------------------------------------------------
// ADMINISTRATION — UPLOAD R2 D'UN TEMPLATE
// ------------------------------------------------------------
//
// Le navigateur envoie directement le contenu binaire du fichier .wplace
// au Worker. Le Worker écrit dans le bucket R2 privé via le binding
// TEMPLATES_BUCKET, puis met à jour D1.
//
// Les objets R2 sont immuables : chaque upload reçoit une nouvelle clé.
// L'ancienne clé reste donc disponible pour l'historique/versioning.
//
// Limite volontaire : 100 MiB par upload via cette route.
// ------------------------------------------------------------

if (adminTemplateUploadMatch && request.method === "POST") {
  const session = await requireAdminOrModerator(request, env);
  if (!session) {
    return jsonAuth(
      request,
      { error: "Accès administrateur requis" },
      403,
      env
    );
  }

  const templateId = Number(adminTemplateUploadMatch[1]);
  const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

  const filenameHeader = request.headers.get("X-Template-Filename") || "template.wplace";
  const filename = filenameHeader
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .trim();

  if (
    !filename ||
    filename.length > 255 ||
    !/\.wplace$/i.test(filename)
  ) {
    return jsonAuth(
      request,
      { error: "Le fichier doit avoir une extension .wplace" },
      400,
      env
    );
  }

  const contentLengthHeader = request.headers.get("Content-Length");
  const contentLength = contentLengthHeader == null
    ? null
    : Number(contentLengthHeader);

  if (
    contentLength !== null &&
    (!Number.isFinite(contentLength) || contentLength <= 0)
  ) {
    return jsonAuth(
      request,
      { error: "Taille de fichier invalide" },
      400,
      env
    );
  }

  if (contentLength !== null && contentLength > MAX_UPLOAD_BYTES) {
    return jsonAuth(
      request,
      { error: "Fichier trop volumineux (100 MiB maximum)" },
      413,
      env
    );
  }

  if (!request.body) {
    return jsonAuth(
      request,
      { error: "Corps du fichier absent" },
      400,
      env
    );
  }

  try {
    const template = await env.DB.prepare(`
      SELECT
        t.id,
        t.zone_id,
        t.slug,
        t.name,
        t.description,
        t.r2_key,
        t.wplace_url,
        t.status,
        t.version,
        z.slug AS zone_slug,
        z.name AS zone_name
      FROM templates t
      INNER JOIN zones z ON z.id = t.zone_id
      WHERE t.id = ?
      LIMIT 1
    `).bind(templateId).first();

    if (!template) {
      return jsonAuth(
        request,
        { error: "Template introuvable" },
        404,
        env
      );
    }

    if (template.status === "archived" || template.status === "rejected") {
      return jsonAuth(
        request,
        { error: "Impossible d'uploader un fichier pour un template archivé ou rejeté" },
        400,
        env
      );
    }

    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`
        SELECT 1
        FROM zone_moderators
        WHERE zone_id = ?
          AND discord_user_id = ?
        LIMIT 1
      `).bind(template.zone_id, session.user.id).first();

      if (!assigned) {
        await writeAdminLog(
          env,
          session.user.id,
          "template_upload",
          "template",
          templateId,
          "denied",
          "Zone non attribuée"
        );

        return jsonAuth(
          request,
          { error: "Cette zone ne vous est pas attribuée" },
          403,
          env
        );
      }
    }

    // Si Content-Length est absent, on bufferise uniquement dans ce cas
    // afin de pouvoir appliquer la même limite de taille.
    let uploadBody = request.body;

    if (contentLength === null) {
      const buffer = await request.arrayBuffer();

      if (buffer.byteLength === 0) {
        return jsonAuth(
          request,
          { error: "Le fichier est vide" },
          400,
          env
        );
      }

      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        return jsonAuth(
          request,
          { error: "Fichier trop volumineux (100 MiB maximum)" },
          413,
          env
        );
      }

      uploadBody = buffer;
    } else if (contentLength === 0) {
      return jsonAuth(
        request,
        { error: "Le fichier est vide" },
        400,
        env
      );
    }

    const newVersion = Number(template.version || 1) + 1;
    const r2Key =
      `templates/${template.zone_slug}/${template.slug}/v${newVersion}-${crypto.randomUUID()}.wplace`;

    const contentType =
      request.headers.get("Content-Type") || "application/octet-stream";

    // 1. Upload R2.
    await env.TEMPLATES_BUCKET.put(r2Key, uploadBody, {
      httpMetadata: {
        contentType
      },
      customMetadata: {
        templateId: String(templateId),
        zoneId: String(template.zone_id),
        filename
      }
    });

    const now = Math.floor(Date.now() / 1000);

    const snapshot = {
      id: Number(template.id),
      zone_id: Number(template.zone_id),
      slug: template.slug,
      name: template.name,
      description: template.description || null,
      r2_key: r2Key,
      wplace_url: template.wplace_url || null,
      status: template.status,
      version: newVersion,
      filename
    };

    try {
      // 2. D1 : nouvelle version + historique.
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE templates
          SET
            r2_key = ?,
            version = ?,
            updated_by = ?,
            updated_at = ?
          WHERE id = ?
        `).bind(
          r2Key,
          newVersion,
          session.user.id,
          now,
          templateId
        ),

        env.DB.prepare(`
          INSERT INTO template_history
            (
              template_id,
              version,
              action,
              r2_key,
              snapshot,
              author_discord_id,
              created_at
            )
          VALUES (?, ?, 'upload', ?, ?, ?, ?)
        `).bind(
          templateId,
          newVersion,
          r2Key,
          JSON.stringify(snapshot),
          session.user.id,
          now
        )
      ]);
    } catch (dbError) {
      // Si D1 échoue après l'upload, on tente de supprimer uniquement
      // le nouvel objet afin d'éviter un fichier R2 orphelin.
      try {
        await env.TEMPLATES_BUCKET.delete(r2Key);
      } catch (cleanupError) {
        console.error(
          "Erreur nettoyage R2 après échec D1:",
          cleanupError
        );
      }

      throw dbError;
    }

    const updated = await env.DB.prepare(`
      SELECT
        t.id,
        t.zone_id,
        z.slug AS zone_slug,
        z.name AS zone_name,
        t.slug,
        t.name,
        t.description,
        t.r2_key,
        t.wplace_url,
        t.status,
        t.version,
        t.created_by,
        t.updated_by,
        t.created_at,
        t.updated_at
      FROM templates t
      INNER JOIN zones z ON z.id = t.zone_id
      WHERE t.id = ?
      LIMIT 1
    `).bind(templateId).first();

    await writeAdminLog(
      env,
      session.user.id,
      "template_upload",
      "template",
      templateId,
      "success",
      "Fichier .wplace uploadé dans R2",
      {
        version: newVersion,
        r2_key: r2Key,
        filename,
        bytes: contentLength
      }
    );

    return jsonAuth(
      request,
      {
        ok: true,
        template: updated,
        upload: {
          filename,
          r2_key: r2Key,
          version: newVersion
        }
      },
      200,
      env
    );
  } catch (error) {
    console.error(
      "Erreur R2 /api/admin/templates/:id/upload:",
      error
    );

    await writeAdminLog(
      env,
      session.user.id,
      "template_upload",
      "template",
      templateId,
      "error",
      "Échec de l'upload R2",
      {
        message: String(error?.message || error),
        filename
      }
    );

    return jsonAuth(
      request,
      { error: "Impossible d'uploader le fichier dans R2" },
      500,
      env
    );
  }
}

if (url.pathname === "/api/admin/radars" && request.method === "POST") {
  const session = await requireAdminOrModerator(request, env);

  if (!session) {
    return jsonAuth(
      request,
      { error: "Accès administrateur requis" },
      403,
      env
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonAuth(
      request,
      { error: "Requête JSON invalide" },
      400,
      env
    );
  }

  try {
    // ----------------------------------------------------------
    // DONNÉES DE BASE
    // ----------------------------------------------------------

    const zoneId = Number(body?.zone_id);
    const type = String(body?.type || "").trim().toLowerCase();

    const status =
      body?.status == null
        ? "paused"
        : String(body.status).trim().toLowerCase();

    const notificationMode =
      body?.notification_mode == null
        ? "observation"
        : String(body.notification_mode).trim().toLowerCase();

    const scanInterval =
      body?.scan_interval_seconds == null
        ? 120
        : Number(body.scan_interval_seconds);

    const alertThreshold =
      body?.alert_threshold == null || body.alert_threshold === ""
        ? null
        : Number(body.alert_threshold);

    const urgencyThreshold =
      body?.urgency_threshold == null || body.urgency_threshold === ""
        ? null
        : Number(body.urgency_threshold);

    // ----------------------------------------------------------
    // VALIDATION DE BASE
    // ----------------------------------------------------------

    if (!Number.isInteger(zoneId) || zoneId <= 0) {
      return jsonAuth(
        request,
        { error: "Zone invalide" },
        400,
        env
      );
    }

    if (!["zone", "rectangle"].includes(type)) {
      return jsonAuth(
        request,
        { error: "Type de Radar invalide" },
        400,
        env
      );
    }

    if (!["active", "paused"].includes(status)) {
      return jsonAuth(
        request,
        { error: "Statut invalide" },
        400,
        env
      );
    }

    if (!["observation", "automatic"].includes(notificationMode)) {
      return jsonAuth(
        request,
        { error: "Mode de notification invalide" },
        400,
        env
      );
    }

    if (
      !Number.isInteger(scanInterval) ||
      scanInterval < 60
    ) {
      return jsonAuth(
        request,
        { error: "L'intervalle de scan doit être un entier d'au moins 60 secondes" },
        400,
        env
      );
    }

    if (
      alertThreshold !== null &&
      (!Number.isInteger(alertThreshold) || alertThreshold < 0)
    ) {
      return jsonAuth(
        request,
        { error: "Seuil d'alerte invalide" },
        400,
        env
      );
    }

    if (
      urgencyThreshold !== null &&
      (!Number.isInteger(urgencyThreshold) || urgencyThreshold < 0)
    ) {
      return jsonAuth(
        request,
        { error: "Seuil d'urgence invalide" },
        400,
        env
      );
    }

    if (
      alertThreshold !== null &&
      urgencyThreshold !== null &&
      urgencyThreshold < alertThreshold
    ) {
      return jsonAuth(
        request,
        { error: "Le seuil d'urgence doit être supérieur ou égal au seuil d'alerte" },
        400,
        env
      );
    }

    // ----------------------------------------------------------
    // ZONE
    // ----------------------------------------------------------

    const zone = await env.DB.prepare(`
      SELECT id, slug, name, status
      FROM zones
      WHERE id = ?
      LIMIT 1
    `).bind(zoneId).first();

    if (!zone) {
      return jsonAuth(
        request,
        { error: "Zone introuvable" },
        404,
        env
      );
    }

    if (zone.status !== "active") {
      return jsonAuth(
        request,
        { error: "La zone doit être active" },
        400,
        env
      );
    }

    // Les non-admins doivent être affectés à la zone.
    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`
        SELECT 1
        FROM zone_moderators
        WHERE zone_id = ?
          AND discord_user_id = ?
        LIMIT 1
      `).bind(zoneId, session.user.id).first();

      if (!assigned) {
        await writeAdminLog(
          env,
          session.user.id,
          "radar_create",
          "zone",
          zoneId,
          "denied",
          "Zone non attribuée"
        );

        return jsonAuth(
          request,
          { error: "Cette zone ne vous est pas attribuée" },
          403,
          env
        );
      }
    }

    // ----------------------------------------------------------
    // GÉOMÉTRIE
    // ----------------------------------------------------------

    let geometry = null;

    if (type === "zone") {
      // Un Radar zone utilise directement le polygone de la zone.
      if (
        body &&
        Object.prototype.hasOwnProperty.call(body, "geometry") &&
        body.geometry != null
      ) {
        return jsonAuth(
          request,
          { error: "Un Radar de type zone ne doit pas avoir de géométrie" },
          400,
          env
        );
      }
    }

    if (type === "rectangle") {
      let rectangle = body?.geometry;

      if (typeof rectangle === "string") {
        try {
          rectangle = JSON.parse(rectangle);
        } catch {
          return jsonAuth(
            request,
            { error: "Géométrie JSON invalide" },
            400,
            env
          );
        }
      }

      if (
        !rectangle ||
        typeof rectangle !== "object" ||
        Array.isArray(rectangle)
      ) {
        return jsonAuth(
          request,
          { error: "La géométrie du rectangle est invalide" },
          400,
          env
        );
      }

      const west = Number(
        rectangle.west ??
        rectangle.minLng ??
        rectangle.minLon
      );

      const south = Number(
        rectangle.south ??
        rectangle.minLat
      );

      const east = Number(
        rectangle.east ??
        rectangle.maxLng ??
        rectangle.maxLon
      );

      const north = Number(
        rectangle.north ??
        rectangle.maxLat
      );

      if (
        ![
          west,
          south,
          east,
          north
        ].every(Number.isFinite)
      ) {
        return jsonAuth(
          request,
          { error: "Coordonnées du rectangle invalides" },
          400,
          env
        );
      }

      if (
        west > east ||
        south > north ||
        west < -180 ||
        east > 180 ||
        south < -90 ||
        north > 90
      ) {
        return jsonAuth(
          request,
          { error: "Rectangle géographique invalide" },
          400,
          env
        );
      }

      if (west === east || south === north) {
        return jsonAuth(
          request,
          { error: "Le rectangle doit avoir une surface non nulle" },
          400,
          env
        );
      }

      // On stocke toujours une forme canonique.
      geometry = JSON.stringify({
        west,
        south,
        east,
        north
      });
    }

    // ----------------------------------------------------------
    // IDENTIFIANT
    // ----------------------------------------------------------

    const radarId = crypto.randomUUID();

    // ----------------------------------------------------------
    // CRÉATION
    // ----------------------------------------------------------

    await env.DB.prepare(`
      INSERT INTO radars (
        id,
        zone_id,
        created_by,
        type,
        geometry,
        status,
        scan_interval_seconds,
        notification_mode,
        alert_threshold,
        urgency_threshold
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      radarId,
      zoneId,
      session.user.id,
      type,
      geometry,
      status,
      scanInterval,
      notificationMode,
      alertThreshold,
      urgencyThreshold
    ).run();

    // ----------------------------------------------------------
    // LECTURE DU RADAR CRÉÉ
    // ----------------------------------------------------------

    const created = await env.DB.prepare(`
      SELECT
        r.id,
        r.zone_id,
        z.slug AS zone_slug,
        z.name AS zone_name,
        z.status AS zone_status,
        r.created_by,
        r.type,
        r.geometry,
        r.status,
        r.scan_interval_seconds,
        r.notification_mode,
        r.alert_threshold,
        r.urgency_threshold,
        r.last_scan_at,
        r.last_success_at,
        r.last_error_at,
        r.created_at,
        r.updated_at
      FROM radars r
      INNER JOIN zones z
        ON z.id = r.zone_id
      WHERE r.id = ?
      LIMIT 1
    `).bind(radarId).first();

    await writeAdminLog(
      env,
      session.user.id,
      "radar_create",
      "radar",
      radarId,
      "success",
      "Radar créé",
      {
        zone_id: zoneId,
        type,
        status,
        notification_mode: notificationMode
      }
    );

    return jsonAuth(
      request,
      {
        ok: true,
        radar: created
      },
      201,
      env
    );

  } catch (error) {
    console.error("Erreur D1 /api/admin/radars POST:", error);

    await writeAdminLog(
      env,
      session.user.id,
      "radar_create",
      "radar",
      null,
      "error",
      "Échec de création du Radar",
      {
        message: String(error?.message || error)
      }
    );

    // Les contraintes D1 sont volontairement conservées.
    // On expose une erreur métier lisible sans masquer le contrôle DB.
    const message = String(error?.message || error);

    if (
      message.includes("maximum de 2 Radars rectangle par zone")
    ) {
      return jsonAuth(
        request,
        { error: "Cette zone possède déjà le maximum de 2 Radars rectangle actifs ou en pause" },
        409,
        env
      );
    }

    if (
      message.includes("UNIQUE constraint failed") ||
      message.includes("idx_radars_one_zone_radar")
    ) {
      return jsonAuth(
        request,
        { error: "Cette zone possède déjà un Radar de type zone actif ou en pause" },
        409,
        env
      );
    }

    return jsonAuth(
      request,
      { error: "Impossible de créer le Radar" },
      500,
      env
    );
  }
}
// ------------------------------------------------------------
// ADMINISTRATION — RADARS
// ------------------------------------------------------------

if (url.pathname === "/api/admin/radars" && request.method === "GET") {
  const session = await requireAdminOrModerator(request, env);

  if (!session) {
    return jsonAuth(
      request,
      { error: "Accès administrateur requis" },
      403,
      env
    );
  }

  try {
    const sql = session.access === "admin"
      ? `
        SELECT
          r.id,
          r.zone_id,
          z.slug AS zone_slug,
          z.name AS zone_name,
          z.status AS zone_status,
          r.created_by,
          r.type,
          r.geometry,
          r.status,
          r.scan_interval_seconds,
          r.notification_mode,
          r.alert_threshold,
          r.urgency_threshold,
          r.last_scan_at,
          r.last_success_at,
          r.last_error_at,
          r.created_at,
          r.updated_at
        FROM radars r
        INNER JOIN zones z
          ON z.id = r.zone_id
        ORDER BY
          z.name ASC,
          r.id ASC
      `
      : `
        SELECT
          r.id,
          r.zone_id,
          z.slug AS zone_slug,
          z.name AS zone_name,
          z.status AS zone_status,
          r.created_by,
          r.type,
          r.geometry,
          r.status,
          r.scan_interval_seconds,
          r.notification_mode,
          r.alert_threshold,
          r.urgency_threshold,
          r.last_scan_at,
          r.last_success_at,
          r.last_error_at,
          r.created_at,
          r.updated_at
        FROM radars r
        INNER JOIN zones z
          ON z.id = r.zone_id
        INNER JOIN zone_moderators mine
          ON mine.zone_id = z.id
         AND mine.discord_user_id = ?
        ORDER BY
          z.name ASC,
          r.id ASC
      `;

    const result = session.access === "admin"
      ? await env.DB.prepare(sql).all()
      : await env.DB.prepare(sql).bind(session.user.id).all();

    return jsonAuth(
      request,
      result?.results || [],
      200,
      env
    );

  } catch (error) {
    console.error("Erreur D1 /api/admin/radars GET:", error);

    return jsonAuth(
      request,
      { error: "Erreur lors de la lecture des Radars" },
      500,
      env
    );
  }
}

const adminRadarIdMatch = url.pathname.match(
  /^\/api\/admin\/radars\/([^/]+)$/
);
// ----------------------------------------------------------
// TEST — ÉLIGIBILITÉ DU PROCHAIN SCAN
// ----------------------------------------------------------

if (adminRadarIdMatch && request.method === "GET" && url.searchParams.get("scan_status") === "1") {
  const session = await requireAdminOrModerator(request, env);

  if (!session) {
    return jsonAuth(
      request,
      { error: "Accès administrateur requis" },
      403,
      env
    );
  }

  const radarId = adminRadarIdMatch[1];

  try {
    const radar = await env.DB.prepare(`
      SELECT
        r.id,
        r.zone_id,
        r.type,
        r.status,
        r.scan_interval_seconds,
        r.last_scan_at,
        r.updated_at
      FROM radars r
      WHERE r.id = ?
      LIMIT 1
    `).bind(radarId).first();

    if (!radar) {
      return jsonAuth(
        request,
        { error: "Radar introuvable" },
        404,
        env
      );
    }

    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`
        SELECT 1
        FROM zone_moderators
        WHERE zone_id = ?
          AND discord_user_id = ?
        LIMIT 1
      `).bind(
        radar.zone_id,
        session.user.id
      ).first();

      if (!assigned) {
        return jsonAuth(
          request,
          { error: "Ce Radar ne vous est pas attribué" },
          403,
          env
        );
      }
    }

    const due = isRadarScanDue(radar);

    return jsonAuth(
      request,
      {
        ok: true,
        radar_id: radar.id,
        status: due
      },
      200,
      env
    );

  } catch (error) {
    console.error(
      "Erreur test /api/admin/radars/:id?scan_status=1:",
      error
    );

    return jsonAuth(
      request,
      { error: "Impossible de calculer l'état du scan" },
      500,
      env
    );
  }
}
if (adminRadarIdMatch && request.method === "GET") {
  const session = await requireAdminOrModerator(request, env);

  if (!session) {
    return jsonAuth(
      request,
      { error: "Accès administrateur requis" },
      403,
      env
    );
  }

  const radarId = adminRadarIdMatch[1];

  try {
    const radar = await env.DB.prepare(`
      SELECT
        r.id,
        r.zone_id,
        z.slug AS zone_slug,
        z.name AS zone_name,
        z.status AS zone_status,
        r.created_by,
        r.type,
        r.geometry,
        r.status,
        r.scan_interval_seconds,
        r.notification_mode,
        r.alert_threshold,
        r.urgency_threshold,
        r.last_scan_at,
        r.last_success_at,
        r.last_error_at,
        r.created_at,
        r.updated_at
      FROM radars r
      INNER JOIN zones z
        ON z.id = r.zone_id
      WHERE r.id = ?
      LIMIT 1
    `).bind(radarId).first();

    if (!radar) {
      return jsonAuth(
        request,
        { error: "Radar introuvable" },
        404,
        env
      );
    }

    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`
        SELECT 1
        FROM zone_moderators
        WHERE zone_id = ?
          AND discord_user_id = ?
        LIMIT 1
      `).bind(
        radar.zone_id,
        session.user.id
      ).first();

      if (!assigned) {
        await writeAdminLog(
          env,
          session.user.id,
          "radar_read",
          "radar",
          radarId,
          "denied",
          "Zone non attribuée"
        );

        return jsonAuth(
          request,
          { error: "Ce Radar ne vous est pas attribué" },
          403,
          env
        );
      }
    }

    return jsonAuth(
      request,
      radar,
      200,
      env
    );

  } catch (error) {
    console.error(
      "Erreur D1 /api/admin/radars/:id GET:",
      error
    );

    return jsonAuth(
      request,
      { error: "Erreur lors de la lecture du Radar" },
      500,
      env
    );
  }
}

if (adminRadarIdMatch && ["PATCH", "PUT"].includes(request.method)) {
  const session = await requireAdminOrModerator(request, env);

  if (!session) {
    return jsonAuth(
      request,
      { error: "Accès administrateur requis" },
      403,
      env
    );
  }

  const radarId = adminRadarIdMatch[1];

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonAuth(
      request,
      { error: "Requête JSON invalide" },
      400,
      env
    );
  }

  try {
    const current = await env.DB.prepare(`
      SELECT
        r.*,
        z.slug AS zone_slug,
        z.name AS zone_name,
        z.status AS zone_status
      FROM radars r
      INNER JOIN zones z
        ON z.id = r.zone_id
      WHERE r.id = ?
      LIMIT 1
    `).bind(radarId).first();

    if (!current) {
      return jsonAuth(
        request,
        { error: "Radar introuvable" },
        404,
        env
      );
    }

    // ----------------------------------------------------------
    // PERMISSION SUR LA ZONE ACTUELLE
    // ----------------------------------------------------------

    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`
        SELECT 1
        FROM zone_moderators
        WHERE zone_id = ?
          AND discord_user_id = ?
        LIMIT 1
      `).bind(
        current.zone_id,
        session.user.id
      ).first();

      if (!assigned) {
        await writeAdminLog(
          env,
          session.user.id,
          "radar_update",
          "radar",
          radarId,
          "denied",
          "Zone non attribuée"
        );

        return jsonAuth(
          request,
          { error: "Ce Radar ne vous est pas attribué" },
          403,
          env
        );
      }
    }

    // ----------------------------------------------------------
    // VALEURS FINALES
    // ----------------------------------------------------------

    const zoneId = Object.prototype.hasOwnProperty.call(body, "zone_id")
      ? Number(body.zone_id)
      : Number(current.zone_id);

    const type = Object.prototype.hasOwnProperty.call(body, "type")
      ? String(body.type || "").trim().toLowerCase()
      : current.type;

    const status = Object.prototype.hasOwnProperty.call(body, "status")
      ? String(body.status || "").trim().toLowerCase()
      : current.status;

    const notificationMode =
      Object.prototype.hasOwnProperty.call(body, "notification_mode")
        ? String(body.notification_mode || "").trim().toLowerCase()
        : current.notification_mode;

    const scanInterval =
      Object.prototype.hasOwnProperty.call(body, "scan_interval_seconds")
        ? Number(body.scan_interval_seconds)
        : Number(current.scan_interval_seconds);

    const alertThreshold =
      Object.prototype.hasOwnProperty.call(body, "alert_threshold")
        ? (
            body.alert_threshold == null || body.alert_threshold === ""
              ? null
              : Number(body.alert_threshold)
          )
        : current.alert_threshold == null
          ? null
          : Number(current.alert_threshold);

    const urgencyThreshold =
      Object.prototype.hasOwnProperty.call(body, "urgency_threshold")
        ? (
            body.urgency_threshold == null || body.urgency_threshold === ""
              ? null
              : Number(body.urgency_threshold)
          )
        : current.urgency_threshold == null
          ? null
          : Number(current.urgency_threshold);

    // ----------------------------------------------------------
    // VALIDATION
    // ----------------------------------------------------------

    if (!Number.isInteger(zoneId) || zoneId <= 0) {
      return jsonAuth(
        request,
        { error: "Zone invalide" },
        400,
        env
      );
    }

    if (!["zone", "rectangle"].includes(type)) {
      return jsonAuth(
        request,
        { error: "Type de Radar invalide" },
        400,
        env
      );
    }

    if (!["active", "paused", "archived"].includes(status)) {
      return jsonAuth(
        request,
        { error: "Statut invalide" },
        400,
        env
      );
    }

    if (!["observation", "automatic"].includes(notificationMode)) {
      return jsonAuth(
        request,
        { error: "Mode de notification invalide" },
        400,
        env
      );
    }

    if (
      !Number.isInteger(scanInterval) ||
      scanInterval < 60
    ) {
      return jsonAuth(
        request,
        { error: "L'intervalle de scan doit être un entier d'au moins 60 secondes" },
        400,
        env
      );
    }

    if (
      alertThreshold !== null &&
      (!Number.isInteger(alertThreshold) || alertThreshold < 0)
    ) {
      return jsonAuth(
        request,
        { error: "Seuil d'alerte invalide" },
        400,
        env
      );
    }

    if (
      urgencyThreshold !== null &&
      (!Number.isInteger(urgencyThreshold) || urgencyThreshold < 0)
    ) {
      return jsonAuth(
        request,
        { error: "Seuil d'urgence invalide" },
        400,
        env
      );
    }

    if (
      alertThreshold !== null &&
      urgencyThreshold !== null &&
      urgencyThreshold < alertThreshold
    ) {
      return jsonAuth(
        request,
        { error: "Le seuil d'urgence doit être supérieur ou égal au seuil d'alerte" },
        400,
        env
      );
    }

    // ----------------------------------------------------------
    // NOUVELLE ZONE
    // ----------------------------------------------------------

    const zone = await env.DB.prepare(`
      SELECT id, slug, name, status
      FROM zones
      WHERE id = ?
      LIMIT 1
    `).bind(zoneId).first();

    if (!zone) {
      return jsonAuth(
        request,
        { error: "Zone introuvable" },
        404,
        env
      );
    }

    if (zone.status !== "active") {
      return jsonAuth(
        request,
        { error: "La zone doit être active" },
        400,
        env
      );
    }

    // Si le Radar change de zone, le nouvel accès doit également
    // être autorisé pour un modérateur.
    if (
      session.access !== "admin" &&
      zoneId !== Number(current.zone_id)
    ) {
      const assigned = await env.DB.prepare(`
        SELECT 1
        FROM zone_moderators
        WHERE zone_id = ?
          AND discord_user_id = ?
        LIMIT 1
      `).bind(
        zoneId,
        session.user.id
      ).first();

      if (!assigned) {
        await writeAdminLog(
          env,
          session.user.id,
          "radar_update",
          "radar",
          radarId,
          "denied",
          "Nouvelle zone non attribuée"
        );

        return jsonAuth(
          request,
          { error: "La nouvelle zone ne vous est pas attribuée" },
          403,
          env
        );
      }
    }

    // ----------------------------------------------------------
    // GÉOMÉTRIE
    // ----------------------------------------------------------

    let geometry = null;

    if (type === "zone") {
      if (
        body &&
        Object.prototype.hasOwnProperty.call(body, "geometry") &&
        body.geometry != null
      ) {
        return jsonAuth(
          request,
          { error: "Un Radar de type zone ne doit pas avoir de géométrie" },
          400,
          env
        );
      }

      geometry = null;
    }

    if (type === "rectangle") {
      let rectangle;

      if (
        Object.prototype.hasOwnProperty.call(body, "geometry")
      ) {
        rectangle = body.geometry;
      } else {
        try {
          rectangle = current.geometry
            ? JSON.parse(current.geometry)
            : null;
        } catch {
          rectangle = null;
        }
      }

      if (typeof rectangle === "string") {
        try {
          rectangle = JSON.parse(rectangle);
        } catch {
          return jsonAuth(
            request,
            { error: "Géométrie JSON invalide" },
            400,
            env
          );
        }
      }

      if (
        !rectangle ||
        typeof rectangle !== "object" ||
        Array.isArray(rectangle)
      ) {
        return jsonAuth(
          request,
          { error: "La géométrie du rectangle est invalide" },
          400,
          env
        );
      }

      const west = Number(
        rectangle.west ??
        rectangle.minLng ??
        rectangle.minLon
      );

      const south = Number(
        rectangle.south ??
        rectangle.minLat
      );

      const east = Number(
        rectangle.east ??
        rectangle.maxLng ??
        rectangle.maxLon
      );

      const north = Number(
        rectangle.north ??
        rectangle.maxLat
      );

      if (
        ![
          west,
          south,
          east,
          north
        ].every(Number.isFinite)
      ) {
        return jsonAuth(
          request,
          { error: "Coordonnées du rectangle invalides" },
          400,
          env
        );
      }

      if (
        west > east ||
        south > north ||
        west < -180 ||
        east > 180 ||
        south < -90 ||
        north > 90
      ) {
        return jsonAuth(
          request,
          { error: "Rectangle géographique invalide" },
          400,
          env
        );
      }

      if (west === east || south === north) {
        return jsonAuth(
          request,
          { error: "Le rectangle doit avoir une surface non nulle" },
          400,
          env
        );
      }

      geometry = JSON.stringify({
        west,
        south,
        east,
        north
      });
    }

    // ----------------------------------------------------------
    // MISE À JOUR
    // ----------------------------------------------------------

    const now = new Date().toISOString();

    await env.DB.prepare(`
      UPDATE radars
      SET
        zone_id = ?,
        type = ?,
        geometry = ?,
        status = ?,
        scan_interval_seconds = ?,
        notification_mode = ?,
        alert_threshold = ?,
        urgency_threshold = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      zoneId,
      type,
      geometry,
      status,
      scanInterval,
      notificationMode,
      alertThreshold,
      urgencyThreshold,
      now,
      radarId
    ).run();

    // ----------------------------------------------------------
    // LECTURE DU RADAR MIS À JOUR
    // ----------------------------------------------------------

    const updated = await env.DB.prepare(`
      SELECT
        r.id,
        r.zone_id,
        z.slug AS zone_slug,
        z.name AS zone_name,
        z.status AS zone_status,
        r.created_by,
        r.type,
        r.geometry,
        r.status,
        r.scan_interval_seconds,
        r.notification_mode,
        r.alert_threshold,
        r.urgency_threshold,
        r.last_scan_at,
        r.last_success_at,
        r.last_error_at,
        r.created_at,
        r.updated_at
      FROM radars r
      INNER JOIN zones z
        ON z.id = r.zone_id
      WHERE r.id = ?
      LIMIT 1
    `).bind(radarId).first();

    await writeAdminLog(
      env,
      session.user.id,
      "radar_update",
      "radar",
      radarId,
      "success",
      "Radar mis à jour",
      {
        zone_id: zoneId,
        type,
        status,
        notification_mode: notificationMode
      }
    );

    return jsonAuth(
      request,
      {
        ok: true,
        radar: updated
      },
      200,
      env
    );

  } catch (error) {
    console.error(
      "Erreur D1 /api/admin/radars/:id PATCH:",
      error
    );

    await writeAdminLog(
      env,
      session.user.id,
      "radar_update",
      "radar",
      radarId,
      "error",
      "Échec de mise à jour du Radar",
      {
        message: String(error?.message || error)
      }
    );

    const message = String(error?.message || error);

    if (
      message.includes("maximum de 2 Radars rectangle par zone")
    ) {
      return jsonAuth(
        request,
        {
          error:
            "Cette zone possède déjà le maximum de 2 Radars rectangle actifs ou en pause"
        },
        409,
        env
      );
    }

    if (
      message.includes("UNIQUE constraint failed") ||
      message.includes("idx_radars_one_zone_radar")
    ) {
      return jsonAuth(
        request,
        {
          error:
            "Cette zone possède déjà un Radar de type zone actif ou en pause"
        },
        409,
        env
      );
    }

    return jsonAuth(
      request,
      { error: "Impossible de modifier le Radar" },
      500,
      env
    );
  }
}

// ------------------------------------------------------------
// DELETE = archivage logique : aucune suppression physique
// ------------------------------------------------------------

if (adminRadarIdMatch && request.method === "DELETE") {
  const session = await requireAdminOrModerator(request, env);

  if (!session) {
    return jsonAuth(
      request,
      { error: "Accès administrateur requis" },
      403,
      env
    );
  }

  const radarId = adminRadarIdMatch[1];

  try {
    const current = await env.DB.prepare(`
      SELECT
        r.id,
        r.zone_id,
        r.status,
        z.slug AS zone_slug,
        z.name AS zone_name
      FROM radars r
      INNER JOIN zones z
        ON z.id = r.zone_id
      WHERE r.id = ?
      LIMIT 1
    `).bind(radarId).first();

    if (!current) {
      return jsonAuth(
        request,
        { error: "Radar introuvable" },
        404,
        env
      );
    }

    // ----------------------------------------------------------
    // PERMISSION SUR LA ZONE
    // ----------------------------------------------------------

    if (session.access !== "admin") {
      const assigned = await env.DB.prepare(`
        SELECT 1
        FROM zone_moderators
        WHERE zone_id = ?
          AND discord_user_id = ?
        LIMIT 1
      `).bind(
        current.zone_id,
        session.user.id
      ).first();

      if (!assigned) {
        await writeAdminLog(
          env,
          session.user.id,
          "radar_archive",
          "radar",
          radarId,
          "denied",
          "Zone non attribuée"
        );

        return jsonAuth(
          request,
          { error: "Ce Radar ne vous est pas attribué" },
          403,
          env
        );
      }
    }

    // ----------------------------------------------------------
    // DÉJÀ ARCHIVÉ
    // ----------------------------------------------------------

    if (current.status === "archived") {
      return jsonAuth(
        request,
        {
          ok: true,
          archived: true
        },
        200,
        env
      );
    }

    // ----------------------------------------------------------
    // ARCHIVAGE
    // ----------------------------------------------------------

    const now = new Date().toISOString();

    await env.DB.prepare(`
      UPDATE radars
      SET
        status = 'archived',
        updated_at = ?
      WHERE id = ?
    `).bind(
      now,
      radarId
    ).run();

    await writeAdminLog(
      env,
      session.user.id,
      "radar_archive",
      "radar",
      radarId,
      "success",
      "Radar archivé",
      {
        zone_id: current.zone_id,
        zone_slug: current.zone_slug,
        zone_name: current.zone_name
      }
    );

    return jsonAuth(
      request,
      {
        ok: true,
        archived: true
      },
      200,
      env
    );

  } catch (error) {
    console.error(
      "Erreur D1 /api/admin/radars/:id DELETE/archive:",
      error
    );

    await writeAdminLog(
      env,
      session.user.id,
      "radar_archive",
      "radar",
      radarId,
      "error",
      "Échec d'archivage du Radar",
      {
        message: String(error?.message || error)
      }
    );

    return jsonAuth(
      request,
      { error: "Impossible d'archiver le Radar" },
      500,
      env
    );
  }
}
    // ------------------------------------------------------------
    // ADMINISTRATION — ZONES
    // ------------------------------------------------------------

    if (url.pathname === "/api/admin/zones" && request.method === "GET") {
      const session = await requireAdminOrModerator(request, env);
      if (!session) return jsonAuth(request, { error: "Accès administrateur requis" }, 403, env);

      try {
        let result;

        if (session.access === "admin") {
          result = await env.DB.prepare(`
            SELECT
              z.id, z.slug, z.name, z.description, z.continent, z.country,
              z.owner_name, z.owner_public, z.status, z.version,
              z.created_at, z.updated_at, z.center, z.focus_zoom,
              c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
              COUNT(zm.discord_user_id) AS moderator_count
            FROM zones z
            INNER JOIN categories c ON c.id = z.category_id
            LEFT JOIN zone_moderators zm ON zm.zone_id = z.id
            GROUP BY z.id
            ORDER BY z.status ASC, c.sort_order ASC, z.name ASC
          `).all();
        } else {
          result = await env.DB.prepare(`
            SELECT
              z.id, z.slug, z.name, z.description, z.continent, z.country,
              z.owner_name, z.owner_public, z.status, z.version,
              z.created_at, z.updated_at, z.center, z.focus_zoom,
              c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
              COUNT(zm.discord_user_id) AS moderator_count
            FROM zones z
            INNER JOIN categories c ON c.id = z.category_id
            INNER JOIN zone_moderators mine
              ON mine.zone_id = z.id
             AND mine.discord_user_id = ?
            LEFT JOIN zone_moderators zm ON zm.zone_id = z.id
            GROUP BY z.id
            ORDER BY z.status ASC, c.sort_order ASC, z.name ASC
          `).bind(session.user.id).all();
        }

        return jsonAuth(request, result?.results || [], 200, env);
      } catch (error) {
        console.error("Erreur D1 /admin/zones:", error);
        return jsonAuth(request, { error: "Erreur lors de la lecture des zones administrables" }, 500, env);
      }
    }



    // ------------------------------------------------------------
    // ADMINISTRATION — CRÉATION DE ZONE
    // ------------------------------------------------------------

    if (url.pathname === "/api/admin/zones" && request.method === "POST") {
      const session = await requireAdminOrModerator(request, env);

      // Les Admins globaux peuvent créer n'importe quelle zone.
      // Egitos dispose en DEV du rôle applicatif zone_admin et crée sa propre zone.
      if (!session || !["admin", "zone_admin"].includes(session.access)) {
        if (session?.user?.id) {
          await writeAdminLog(
            env,
            session.user.id,
            "zone_create",
            "zone",
            null,
            "denied",
            "Création de zone réservée aux administrateurs"
          );
        }

        return jsonAuth(
          request,
          { error: "La création de zones est réservée aux administrateurs" },
          403,
          env
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return jsonAuth(request, { error: "Requête JSON invalide" }, 400, env);
      }

      try {
        const name = String(body?.name || "").trim();
        const slug = String(body?.slug || "").trim().toLowerCase();
        const description = String(body?.description || "").trim();
        const continent = String(body?.continent || "").trim();
        const country = String(body?.country || "").trim();

        const ownerName =
          body?.owner_name == null || String(body.owner_name).trim() === ""
            ? null
            : String(body.owner_name).trim();

        const ownerPublic = body?.owner_public ? 1 : 0;
        const status = String(body?.status || "active");
        const focusZoom = Number(body?.focus_zoom);

        if (!name || name.length > 120) {
          return jsonAuth(request, { error: "Nom de zone invalide" }, 400, env);
        }

        if (
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
          slug.length > 80
        ) {
          return jsonAuth(request, { error: "Slug invalide" }, 400, env);
        }

        if (description.length > 1000) {
          return jsonAuth(request, { error: "Description trop longue" }, 400, env);
        }

        if (
          !continent ||
          continent.length > 80 ||
          !country ||
          country.length > 80
        ) {
          return jsonAuth(
            request,
            { error: "Continent ou pays invalide" },
            400,
            env
          );
        }

        if (ownerName && ownerName.length > 120) {
          return jsonAuth(request, { error: "Responsable invalide" }, 400, env);
        }

        if (!["active", "archived"].includes(status)) {
          return jsonAuth(request, { error: "Statut invalide" }, 400, env);
        }

        if (
          !Number.isFinite(focusZoom) ||
          focusZoom < 0 ||
          focusZoom > 24
        ) {
          return jsonAuth(request, { error: "Zoom invalide" }, 400, env);
        }

        // Catégorie active obligatoire.
        const categorySlug = normalizeCategorySlug(body?.category_slug);

        if (!categorySlug) {
          return jsonAuth(request, { error: "Catégorie invalide" }, 400, env);
        }

        const category = await env.DB.prepare(`
          SELECT id
          FROM categories
          WHERE slug = ?
            AND active = 1
          LIMIT 1
        `).bind(categorySlug).first();

        if (!category) {
          return jsonAuth(request, { error: "Catégorie invalide" }, 400, env);
        }

        // ----------------------------------------------------------
        // POLYGONE — [[latitude, longitude], ...]
        // ----------------------------------------------------------

        let polygon = body?.polygon;

        if (typeof polygon === "string") {
          try {
            polygon = JSON.parse(polygon);
          } catch {
            return jsonAuth(
              request,
              { error: "Polygone JSON invalide" },
              400,
              env
            );
          }
        }

        if (
          !Array.isArray(polygon) ||
          polygon.length < 3 ||
          polygon.length > 500
        ) {
          return jsonAuth(
            request,
            { error: "Le polygone doit contenir entre 3 et 500 sommets" },
            400,
            env
          );
        }

        const normalizedPolygon = [];

        for (const point of polygon) {
          if (!Array.isArray(point) || point.length < 2) {
            return jsonAuth(
              request,
              { error: "Sommet de polygone invalide" },
              400,
              env
            );
          }

          const lat = Number(point[0]);
          const lng = Number(point[1]);

          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            lat < -90 ||
            lat > 90 ||
            lng < -180 ||
            lng > 180
          ) {
            return jsonAuth(
              request,
              { error: "Coordonnée géographique invalide" },
              400,
              env
            );
          }

          normalizedPolygon.push([lat, lng]);
        }

        const polygonKeys = normalizedPolygon.map(
          point => point.join(",")
        );

        if (new Set(polygonKeys).size !== polygonKeys.length) {
          return jsonAuth(
            request,
            { error: "Le polygone contient des sommets dupliqués" },
            400,
            env
          );
        }

        // ----------------------------------------------------------
        // CENTRE — { longitude, latitude } ou [longitude, latitude]
        // ----------------------------------------------------------

        let center = body?.center;

        if (typeof center === "string") {
          try {
            center = JSON.parse(center);
          } catch {
            return jsonAuth(
              request,
              { error: "Centre JSON invalide" },
              400,
              env
            );
          }
        }

        const centerLng = Number(
          Array.isArray(center)
            ? center[0]
            : center?.longitude ?? center?.lng
        );

        const centerLat = Number(
          Array.isArray(center)
            ? center[1]
            : center?.latitude ?? center?.lat
        );

        if (
          !Number.isFinite(centerLng) ||
          !Number.isFinite(centerLat) ||
          centerLng < -180 ||
          centerLng > 180 ||
          centerLat < -90 ||
          centerLat > 90
        ) {
          return jsonAuth(
            request,
            { error: "Centre invalide" },
            400,
            env
          );
        }

        // Le slug doit être unique.
        const slugConflict = await env.DB.prepare(`
          SELECT id
          FROM zones
          WHERE slug = ?
          LIMIT 1
        `).bind(slug).first();

        if (slugConflict) {
          return jsonAuth(
            request,
            { error: "Ce slug est déjà utilisé" },
            409,
            env
          );
        }

        const now = Math.floor(Date.now() / 1000);
        const polygonText = JSON.stringify(normalizedPolygon);
        const centerText = JSON.stringify({
          longitude: centerLng,
          latitude: centerLat
        });

        const snapshot = {
          slug,
          name,
          description: description || null,
          category_id: Number(category.id),
          continent,
          country,
          owner_name: ownerName,
          owner_public: ownerPublic,
          polygon: normalizedPolygon,
          status,
          version: 1,
          created_by: session.user.id,
          updated_by: session.user.id,
          center: {
            longitude: centerLng,
            latitude: centerLat
          },
          focus_zoom: focusZoom
        };

        // D1 batch : insertion de la zone puis création de son historique
        // initial. last_insert_rowid() permet de rattacher l'historique
        // à l'ID généré par l'INSERT précédent du même batch.
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO zones
            (
              slug,
              name,
              description,
              category_id,
              continent,
              country,
              owner_name,
              owner_public,
              polygon,
              status,
              version,
              created_by,
              updated_by,
              created_at,
              updated_at,
              center,
              focus_zoom
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            slug,
            name,
            description || null,
            Number(category.id),
            continent,
            country,
            ownerName,
            ownerPublic,
            polygonText,
            status,
            1,
            session.user.id,
            session.user.id,
            now,
            now,
            centerText,
            focusZoom
          ),

          env.DB.prepare(`
            INSERT INTO zone_history
            (
              zone_id,
              version,
              action,
              snapshot,
              author_discord_id,
              created_at
            )
            VALUES ((SELECT id FROM zones WHERE slug = ? LIMIT 1), 1, 'create', ?, ?, ?)
          `).bind(
            slug,
            JSON.stringify(snapshot),
            session.user.id,
            now
          ),

          // Une zone créée par zone_admin lui est automatiquement attribuée.
          // La sous-requête reprend l'ID de la zone nouvellement créée à partir de son slug.
          ...(session.access === "zone_admin"
            ? [env.DB.prepare(`
                INSERT INTO zone_moderators
                  (zone_id, discord_user_id, assigned_by, created_at)
                VALUES ((SELECT id FROM zones WHERE slug = ? LIMIT 1), ?, ?, ?)
              `).bind(slug, session.user.id, session.user.id, now)]
            : [])
        ]);

        const created = await env.DB.prepare(`
          SELECT
            z.id,
            z.slug,
            z.name,
            z.description,
            z.category_id,
            z.continent,
            z.country,
            z.owner_name,
            z.owner_public,
            z.polygon,
            z.status,
            z.version,
            z.created_by,
            z.updated_by,
            z.created_at,
            z.updated_at,
            z.center,
            z.focus_zoom,
            c.slug AS category_slug,
            c.name AS category_name,
            c.color AS category_color
          FROM zones z
          INNER JOIN categories c
            ON c.id = z.category_id
          WHERE z.slug = ?
          LIMIT 1
        `).bind(slug).first();

        if (!created) {
          throw new Error("Zone créée mais introuvable après insertion");
        }

        await writeAdminLog(
          env,
          session.user.id,
          "zone_create",
          "zone",
          Number(created.id),
          "success",
          "Nouvelle zone créée",
          {
            version: 1,
            polygon_points: normalizedPolygon.length
          }
        );

        return jsonAuth(
          request,
          {
            ok: true,
            zone: created
          },
          201,
          env
        );
      } catch (error) {
        console.error(
          "Erreur D1 /api/admin/zones POST:",
          error
        );

        await writeAdminLog(
          env,
          session.user.id,
          "zone_create",
          "zone",
          null,
          "error",
          "Échec de création de zone",
          {
            message: String(error?.message || error)
          }
        );

        return jsonAuth(
          request,
          { error: "Impossible de créer la zone" },
          500,
          env
        );
      }
    }


    // ------------------------------------------------------------
    // ADMINISTRATION — ZONE PAR ID
    // ------------------------------------------------------------

    const adminZoneIdMatch = url.pathname.match(
      /^\/api\/admin\/zones\/(\d+)$/
    );

    if (adminZoneIdMatch && request.method === "GET") {
      const session = await requireAdminOrModerator(request, env);
      if (!session) {
        return jsonAuth(
          request,
          { error: "Accès administrateur requis" },
          403,
          env
        );
      }

      const zoneId = Number(adminZoneIdMatch[1]);

      try {
        let zone;

        if (session.access === "admin") {
          zone = await env.DB.prepare(`
            SELECT
              z.id, z.slug, z.name, z.description,
              z.category_id, z.continent, z.country,
              z.owner_name, z.owner_public, z.polygon,
              z.status, z.version, z.created_by, z.updated_by,
              z.created_at, z.updated_at, z.center, z.focus_zoom,
              c.slug AS category_slug,
              c.name AS category_name,
              c.color AS category_color
            FROM zones z
            INNER JOIN categories c ON c.id = z.category_id
            WHERE z.id = ?
            LIMIT 1
          `).bind(zoneId).first();
        } else {
          zone = await env.DB.prepare(`
            SELECT
              z.id, z.slug, z.name, z.description,
              z.category_id, z.continent, z.country,
              z.owner_name, z.owner_public, z.polygon,
              z.status, z.version, z.created_by, z.updated_by,
              z.created_at, z.updated_at, z.center, z.focus_zoom,
              c.slug AS category_slug,
              c.name AS category_name,
              c.color AS category_color
            FROM zones z
            INNER JOIN categories c ON c.id = z.category_id
            INNER JOIN zone_moderators zm
              ON zm.zone_id = z.id
             AND zm.discord_user_id = ?
            WHERE z.id = ?
            LIMIT 1
          `).bind(session.user.id, zoneId).first();
        }

        if (!zone) {
          return jsonAuth(
            request,
            { error: "Zone introuvable ou non autorisée" },
            404,
            env
          );
        }

        return jsonAuth(request, zone, 200, env);
      } catch (error) {
        console.error("Erreur D1 /admin/zones/:id GET:", error);
        return jsonAuth(
          request,
          { error: "Erreur lors de la lecture de la zone" },
          500,
          env
        );
      }
    }

    if (
      adminZoneIdMatch &&
      ["PATCH", "PUT"].includes(request.method)
    ) {
      const session = await requireAdminOrModerator(request, env);

      if (!session) {
        return jsonAuth(
          request,
          { error: "Accès administrateur requis" },
          403,
          env
        );
      }

      const zoneId = Number(adminZoneIdMatch[1]);

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonAuth(
          request,
          { error: "Requête JSON invalide" },
          400,
          env
        );
      }

      const hasGeometry =
        Object.prototype.hasOwnProperty.call(body || {}, "polygon") ||
        Object.prototype.hasOwnProperty.call(body || {}, "center") ||
        Object.prototype.hasOwnProperty.call(body || {}, "focus_zoom");

      // La géométrie est réservée aux Admins globaux et au zone_admin
      // lorsqu'il intervient sur une zone qui lui est attribuée.
      if (hasGeometry && !["admin", "zone_admin"].includes(session.access)) {
        await writeAdminLog(
          env,
          session.user.id,
          "zone_geometry_update",
          "zone",
          zoneId,
          "denied",
          "Modification géométrique réservée aux Admins"
        );

        return jsonAuth(
          request,
          {
            error:
              "La modification de la géométrie est réservée aux administrateurs"
          },
          403,
          env
        );
      }

      try {
        const current = await env.DB.prepare(`
          SELECT
            z.id, z.slug, z.name, z.description,
            z.category_id, z.continent, z.country,
            z.owner_name, z.owner_public, z.polygon,
            z.status, z.version, z.created_by, z.updated_by,
            z.created_at, z.updated_at, z.center, z.focus_zoom,
            c.slug AS category_slug,
            c.name AS category_name,
            c.color AS category_color
          FROM zones z
          INNER JOIN categories c ON c.id = z.category_id
          WHERE z.id = ?
          LIMIT 1
        `).bind(zoneId).first();

        if (!current) {
          return jsonAuth(
            request,
            { error: "Zone introuvable" },
            404,
            env
          );
        }

        // Un modérateur ne peut modifier que ses zones attribuées.
        if (session.access !== "admin") {
          const assigned = await env.DB.prepare(`
            SELECT 1
            FROM zone_moderators
            WHERE zone_id = ?
              AND discord_user_id = ?
            LIMIT 1
          `).bind(zoneId, session.user.id).first();

          if (!assigned) {
            return jsonAuth(
              request,
              { error: "Cette zone ne vous est pas attribuée" },
              403,
              env
            );
          }
        }

        const allowedStatuses = new Set(["active", "archived"]);

        const name =
          Object.prototype.hasOwnProperty.call(body, "name")
            ? String(body.name || "").trim()
            : current.name;

        const slug =
          Object.prototype.hasOwnProperty.call(body, "slug")
            ? String(body.slug || "").trim().toLowerCase()
            : current.slug;

        const description =
          Object.prototype.hasOwnProperty.call(body, "description")
            ? String(body.description || "").trim()
            : current.description;

        const continent =
          Object.prototype.hasOwnProperty.call(body, "continent")
            ? String(body.continent || "").trim()
            : current.continent;

        const country =
          Object.prototype.hasOwnProperty.call(body, "country")
            ? String(body.country || "").trim()
            : current.country;

        const ownerName =
          Object.prototype.hasOwnProperty.call(body, "owner_name")
            ? (
                body.owner_name == null ||
                String(body.owner_name).trim() === ""
                  ? null
                  : String(body.owner_name).trim()
              )
            : current.owner_name;

        const ownerPublic =
          Object.prototype.hasOwnProperty.call(body, "owner_public")
            ? (body.owner_public ? 1 : 0)
            : Number(current.owner_public || 0);

        const status =
          Object.prototype.hasOwnProperty.call(body, "status")
            ? String(body.status)
            : current.status;

        if (!name || name.length > 120) {
          return jsonAuth(
            request,
            { error: "Nom de zone invalide" },
            400,
            env
          );
        }

        if (
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
          slug.length > 80
        ) {
          return jsonAuth(
            request,
            { error: "Slug invalide" },
            400,
            env
          );
        }

        if (
          !continent ||
          continent.length > 80 ||
          !country ||
          country.length > 80
        ) {
          return jsonAuth(
            request,
            { error: "Continent ou pays invalide" },
            400,
            env
          );
        }

        if (!allowedStatuses.has(status)) {
          return jsonAuth(
            request,
            { error: "Statut invalide" },
            400,
            env
          );
        }

        const slugConflict = await env.DB.prepare(`
          SELECT id
          FROM zones
          WHERE slug = ?
            AND id != ?
          LIMIT 1
        `).bind(slug, zoneId).first();

        if (slugConflict) {
          return jsonAuth(
            request,
            { error: "Ce slug est déjà utilisé" },
            409,
            env
          );
        }

        let categoryId = Number(current.category_id);

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "category_slug"
          )
        ) {
          const category = await env.DB.prepare(`
            SELECT id
            FROM categories
            WHERE slug = ?
              AND active = 1
            LIMIT 1
          `).bind(normalizeCategorySlug(body.category_slug)).first();

          if (!category) {
            return jsonAuth(
              request,
              { error: "Catégorie invalide" },
              400,
              env
            );
          }

          categoryId = Number(category.id);
        }

        // Format application : [[latitude, longitude], ...]
        let polygonText = current.polygon;

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "polygon"
          )
        ) {
          let polygon = body.polygon;

          if (typeof polygon === "string") {
            try {
              polygon = JSON.parse(polygon);
            } catch {
              return jsonAuth(
                request,
                { error: "Polygone JSON invalide" },
                400,
                env
              );
            }
          }

          if (
            !Array.isArray(polygon) ||
            polygon.length < 3 ||
            polygon.length > 500
          ) {
            return jsonAuth(
              request,
              {
                error:
                  "Le polygone doit contenir entre 3 et 500 sommets"
              },
              400,
              env
            );
          }

          const normalized = [];

          for (const point of polygon) {
            if (!Array.isArray(point) || point.length < 2) {
              return jsonAuth(
                request,
                { error: "Sommet de polygone invalide" },
                400,
                env
              );
            }

            const lat = Number(point[0]);
            const lng = Number(point[1]);

            if (
              !Number.isFinite(lat) ||
              !Number.isFinite(lng) ||
              lat < -90 ||
              lat > 90 ||
              lng < -180 ||
              lng > 180
            ) {
              return jsonAuth(
                request,
                { error: "Coordonnée géographique invalide" },
                400,
                env
              );
            }

            normalized.push([lat, lng]);
          }

          const keys = normalized.map(point => point.join(","));

          if (new Set(keys).size !== keys.length) {
            return jsonAuth(
              request,
              {
                error:
                  "Le polygone contient des sommets dupliqués"
              },
              400,
              env
            );
          }

          polygonText = JSON.stringify(normalized);
        }

        // Centre : application -> { longitude, latitude }
        let centerText = current.center;

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "center"
          )
        ) {
          let center = body.center;

          if (typeof center === "string") {
            try {
              center = JSON.parse(center);
            } catch {
              return jsonAuth(
                request,
                { error: "Centre JSON invalide" },
                400,
                env
              );
            }
          }

          const lng = Number(
            Array.isArray(center)
              ? center[0]
              : center?.longitude ?? center?.lng
          );

          const lat = Number(
            Array.isArray(center)
              ? center[1]
              : center?.latitude ?? center?.lat
          );

          if (
            !Number.isFinite(lng) ||
            !Number.isFinite(lat) ||
            lng < -180 ||
            lng > 180 ||
            lat < -90 ||
            lat > 90
          ) {
            return jsonAuth(
              request,
              { error: "Centre invalide" },
              400,
              env
            );
          }

          centerText = JSON.stringify({
            longitude: lng,
            latitude: lat
          });
        }

        let focusZoom = current.focus_zoom;

        if (
          Object.prototype.hasOwnProperty.call(
            body,
            "focus_zoom"
          )
        ) {
          focusZoom = Number(body.focus_zoom);

          if (
            !Number.isFinite(focusZoom) ||
            focusZoom < 0 ||
            focusZoom > 24
          ) {
            return jsonAuth(
              request,
              { error: "Zoom invalide" },
              400,
              env
            );
          }
        }

        const newVersion =
          Number(current.version || 1) + 1;

        const action = hasGeometry
          ? "geometry_update"
          : "update";

        const now = Math.floor(Date.now() / 1000);

        const snapshot = {
          id: Number(current.id),
          slug,
          name,
          description: description || null,
          category_id: categoryId,
          continent,
          country,
          owner_name: ownerName,
          owner_public: ownerPublic,
          polygon: JSON.parse(polygonText),
          status,
          version: newVersion,
          created_by: current.created_by,
          updated_by: session.user.id,
          center: centerText ? JSON.parse(centerText) : null,
          focus_zoom: focusZoom
        };

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE zones
            SET
              slug = ?,
              name = ?,
              description = ?,
              category_id = ?,
              continent = ?,
              country = ?,
              owner_name = ?,
              owner_public = ?,
              polygon = ?,
              status = ?,
              version = ?,
              updated_by = ?,
              center = ?,
              focus_zoom = ?,
              updated_at = ?
            WHERE id = ?
          `).bind(
            slug,
            name,
            description || null,
            categoryId,
            continent,
            country,
            ownerName,
            ownerPublic,
            polygonText,
            status,
            newVersion,
            session.user.id,
            centerText,
            focusZoom,
            now,
            zoneId
          ),

          env.DB.prepare(`
            INSERT INTO zone_history
            (
              zone_id,
              version,
              action,
              snapshot,
              author_discord_id,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            zoneId,
            newVersion,
            action,
            JSON.stringify(snapshot),
            session.user.id,
            now
          )
        ]);

        await writeAdminLog(
          env,
          session.user.id,
          action === "geometry_update"
            ? "zone_geometry_update"
            : "zone_update",
          "zone",
          zoneId,
          "success",
          action === "geometry_update"
            ? "Géométrie de zone mise à jour"
            : "Métadonnées de zone mises à jour",
          {
            version: newVersion,
            polygon_points:
              JSON.parse(polygonText).length
          }
        );

        const updated = await env.DB.prepare(`
          SELECT
            z.id, z.slug, z.name, z.description,
            z.continent, z.country, z.owner_name,
            z.owner_public, z.polygon, z.status,
            z.version, z.created_by, z.updated_by,
            z.created_at, z.updated_at, z.center,
            z.focus_zoom,
            c.slug AS category_slug,
            c.name AS category_name,
            c.color AS category_color
          FROM zones z
          INNER JOIN categories c ON c.id = z.category_id
          WHERE z.id = ?
          LIMIT 1
        `).bind(zoneId).first();

        return jsonAuth(
          request,
          {
            ok: true,
            zone: updated
          },
          200,
          env
        );
      } catch (error) {
        console.error(
          "Erreur D1 /admin/zones/:id update:",
          error
        );

        await writeAdminLog(
          env,
          session.user.id,
          "zone_update",
          "zone",
          zoneId,
          "error",
          "Échec de mise à jour",
          {
            message: String(error?.message || error)
          }
        );

        return jsonAuth(
          request,
          { error: "Impossible d'enregistrer la zone" },
          500,
          env
        );
      }
    }

    // ------------------------------------------------------------
    // ADMINISTRATION — MODÉRATEURS
    // ------------------------------------------------------------

    if (url.pathname === "/api/admin/moderators" && request.method === "GET") {
      const session = await requireAdmin(request, env);
      if (!session) return jsonAuth(request, { error: "Accès Admin requis" }, 403, env);

      try {
        const { results } = await env.DB.prepare(`
          SELECT
            zm.zone_id,
            zm.discord_user_id,
            zm.assigned_by,
            zm.created_at,
            z.slug AS zone_slug,
            z.name AS zone_name
          FROM zone_moderators zm
          INNER JOIN zones z ON z.id = zm.zone_id
          ORDER BY z.name ASC, zm.created_at ASC
        `).all();

        return jsonAuth(request, results, 200, env);
      } catch (error) {
        console.error("Erreur D1 /admin/moderators:", error);
        return jsonAuth(request, { error: "Erreur lors de la lecture des affectations" }, 500, env);
      }
    }

    // ------------------------------------------------------------
    // ADMINISTRATION — VÉRIFICATION MODÉRATEUR
    // ------------------------------------------------------------

    const moderatorVerifyMatch = url.pathname.match(
      /^\/api\/admin\/moderators\/verify\/(\d{17,20})$/
    );

    if (moderatorVerifyMatch && request.method === "GET") {
      const session = await requireAdmin(request, env);
      if (!session) return jsonAuth(request, { error: "Accès Admin requis" }, 403, env);

      const discordUserId = moderatorVerifyMatch[1];
      const member = await fetchDiscordGuildMember(discordUserId, env);

      if (!member?.user?.id) {
        return jsonAuth(request, { error: "Utilisateur introuvable dans le serveur Discord" }, 404, env);
      }

      const roles = Array.isArray(member.roles) ? member.roles : [];
      const isModerator =
        roles.includes(env.DISCORD_MODERATOR_ROLE_ID) ||
        roles.includes(env.DISCORD_ADMIN_ROLE_ID);

      if (!isModerator) {
        return jsonAuth(request, { error: "Cet utilisateur ne possède pas le rôle Modérateur" }, 403, env);
      }

      try {
        const { results } = await env.DB.prepare(`
          SELECT zone_id
          FROM zone_moderators
          WHERE discord_user_id = ?
          ORDER BY zone_id ASC
        `).bind(discordUserId).all();

        return jsonAuth(request, {
          user: {
            id: member.user.id,
            username: member.user.username || null,
            global_name: member.user.global_name || null
          },
          assigned_zone_ids: (results || []).map(row => Number(row.zone_id))
        }, 200, env);
      } catch (error) {
        console.error("Erreur D1 /admin/moderators/verify:", error);
        return jsonAuth(request, { error: "Erreur lors de la lecture des affectations" }, 500, env);
      }
    }

    // ------------------------------------------------------------
    // ADMINISTRATION — AFFECTATIONS MODÉRATEUR
    // ------------------------------------------------------------

    const moderatorManageMatch = url.pathname.match(
      /^\/api\/admin\/moderators\/(\d{17,20})$/
    );

    if (moderatorManageMatch && request.method === "PUT") {
      const session = await requireAdmin(request, env);
      if (!session) return jsonAuth(request, { error: "Accès Admin requis" }, 403, env);

      const discordUserId = moderatorManageMatch[1];
      let body;

      try {
        body = await request.json();
      } catch {
        return jsonAuth(request, { error: "Requête JSON invalide" }, 400, env);
      }

      const requestedZoneIds = Array.isArray(body?.zone_ids)
        ? [...new Set(body.zone_ids.map(value => Number(value)).filter(Number.isInteger))]
        : [];

      const member = await fetchDiscordGuildMember(discordUserId, env);
      if (!member?.user?.id) {
        await writeAdminLog(env, session.user.id, "moderator_assignment_update", "moderator", discordUserId, "denied", "Utilisateur Discord introuvable", { zone_ids: requestedZoneIds });
        return jsonAuth(request, { error: "Utilisateur introuvable dans le serveur Discord" }, 404, env);
      }

      const roles = Array.isArray(member.roles) ? member.roles : [];
      const isModerator =
        roles.includes(env.DISCORD_MODERATOR_ROLE_ID) ||
        roles.includes(env.DISCORD_ADMIN_ROLE_ID);

      if (!isModerator) {
        await writeAdminLog(env, session.user.id, "moderator_assignment_update", "moderator", discordUserId, "denied", "Rôle Modérateur absent", { zone_ids: requestedZoneIds });
        return jsonAuth(request, { error: "Cet utilisateur ne possède pas le rôle Modérateur" }, 403, env);
      }

      if (requestedZoneIds.length > 0) {
        const placeholders = requestedZoneIds.map(() => "?").join(",");
        const { results } = await env.DB.prepare(`
          SELECT id
          FROM zones
          WHERE status = 'active'
            AND id IN (${placeholders})
        `).bind(...requestedZoneIds).all();

        const existingIds = new Set((results || []).map(row => Number(row.id)));
        const invalidIds = requestedZoneIds.filter(id => !existingIds.has(id));
        if (invalidIds.length > 0) {
          await writeAdminLog(env, session.user.id, "moderator_assignment_update", "moderator", discordUserId, "denied", "Zone active invalide", { zone_ids: requestedZoneIds, invalid_zone_ids: invalidIds });
          return jsonAuth(request, { error: "Une ou plusieurs zones sont invalides ou inactives", invalid_zone_ids: invalidIds }, 400, env);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const statements = [
        env.DB.prepare("DELETE FROM zone_moderators WHERE discord_user_id = ?").bind(discordUserId)
      ];

      for (const zoneId of requestedZoneIds) {
        statements.push(
          env.DB.prepare(`
            INSERT INTO zone_moderators (zone_id, discord_user_id, assigned_by, created_at)
            VALUES (?, ?, ?, ?)
          `).bind(zoneId, discordUserId, session.user.id, now)
        );
      }

      statements.push(
        env.DB.prepare(`
          INSERT INTO admin_logs (actor_discord_id, action, target_type, target_id, result, reason, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          session.user.id,
          "moderator_assignment_update",
          "moderator",
          discordUserId,
          "success",
          "Affectations modérateur mises à jour",
          JSON.stringify({ zone_ids: requestedZoneIds }),
          now
        )
      );

      try {
        await env.DB.batch(statements);
        return jsonAuth(request, {
          ok: true,
          user: {
            id: member.user.id,
            username: member.user.username || null,
            global_name: member.user.global_name || null
          },
          zone_ids: requestedZoneIds
        }, 200, env);
      } catch (error) {
        console.error("Erreur D1 /admin/moderators PUT:", error);
        return jsonAuth(request, { error: "Impossible d'enregistrer les affectations" }, 500, env);
      }
    }



    // ------------------------------------------------------------
    // RADAR DEV — TEST SCAN + PIXEL ANALYSIS + EVENT LIFECYCLE
    // ------------------------------------------------------------
    if (url.pathname === "/api/admin/radar/test-scan" && request.method === "POST") {
      const session = await requireAdmin(request, env);
      if (!session) return jsonAuth(request, { error: "Accès Admin requis" }, 403, env);

      if (!env.RADAR_BUCKET) {
        return jsonAuth(request, { error: "Binding RADAR_BUCKET manquant" }, 500, env);
      }
      if (!env.DB) {
        return jsonAuth(request, { error: "Binding DB manquant" }, 500, env);
      }

      let body;
      try { body = await request.json(); }
      catch { return jsonAuth(request, { error: "Requête JSON invalide" }, 400, env); }

      const radarId = String(body?.radar_id || "dev-test").trim();
      const testTiles = Array.isArray(body?.tiles) && body.tiles.length
        ? body.tiles
        : (radarId === "dev-test" ? [{ tileX: 1057, tileY: 751 }] : null);
      const failTile = body?.fail_tile
        && Number.isInteger(Number(body.fail_tile.tileX))
        && Number.isInteger(Number(body.fail_tile.tileY))
        ? { tileX: Number(body.fail_tile.tileX), tileY: Number(body.fail_tile.tileY) }
        : null;

      const result = await runRadarScan(env, radarId, {
        zoneId: body?.zone_id == null ? null : Number(body.zone_id),
        tiles: testTiles,
        minRegionPixels: Number(body?.min_region_pixels ?? 2),
        maxRegions: Number(body?.max_regions ?? 128),
        fetchTile: async (tileX, tileY) => {
          if (failTile && failTile.tileX === tileX && failTile.tileY === tileY) {
            throw new Error(`Échec simulé pour ${radarTileKey(tileX, tileY)}`);
          }
          return fetchRadarProxyTile(env, tileX, tileY);
        }
      });

      return jsonAuth(request, result.data, result.status, env);
    }

    if (url.pathname === "/api/admin/radar/baseline" && request.method === "GET") {
      const session = await requireAdmin(request, env);
      if (!session) return jsonAuth(request, { error: "Accès Admin requis" }, 403, env);
      const radarId = String(url.searchParams.get("radar_id") || "dev-test").trim();
      if (!/^[A-Za-z0-9._:-]{1,120}$/.test(radarId)) {
        return jsonAuth(request, { error: "radar_id invalide" }, 400, env);
      }
      try {
        const current = await getRadarCurrentBaseline(env.DB, radarId);
        if (!current) return jsonAuth(request, { radar_id: radarId, current: null }, 200, env);
        const prefix = radarCommittedPrefix(radarId, current.version) + "/tiles/";
        const listed = await env.RADAR_BUCKET.list({ prefix, limit: 1000 });
        return jsonAuth(request, {
          radar_id: radarId,
          current,
          stored_tile_objects: listed.objects.length,
          complete: listed.objects.length === current.expected_tile_count,
          keys: listed.objects.map(object => object.key)
        }, 200, env);
      } catch (error) {
        return jsonAuth(request, {
          error: "Impossible de lire le baseline Radar",
          detail: String(error?.message || error)
        }, 500, env);
      }
    }


    // ------------------------------------------------------------
    // DISCORD — INTERACTIONS
    // ------------------------------------------------------------

    if (
      url.pathname === "/api/discord/interactions" &&
      request.method === "POST"
    ) {
      return handleDiscordInteraction(request, env);
    }

    // ------------------------------------------------------------
    // 404
    // ------------------------------------------------------------

    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=UTF-8"
      }
    });
  }
};


// ================================================================
// DISCORD — INTERACTIONS
// ================================================================

async function handleDiscordInteraction(request, env) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");

  if (!signature || !timestamp) {
    return new Response("Missing Discord signature", {
      status: 401
    });
  }

  const body = await request.text();

  const isValid = await verifyDiscordSignature(
    body,
    signature,
    timestamp,
    env.DISCORD_PUBLIC_KEY
  );

  if (!isValid) {
    console.error("Discord : signature invalide");

    return new Response("Invalid Discord signature", {
      status: 401
    });
  }

  let interaction;

  try {
    interaction = JSON.parse(body);
  } catch (error) {
    return new Response("Invalid JSON", {
      status: 400
    });
  }

  // ------------------------------------------------------------
  // Vérification de l'application
  // ------------------------------------------------------------

  if (interaction.application_id !== env.DISCORD_APPLICATION_ID) {
    console.error("Discord : application invalide");

    return new Response("Invalid application", {
      status: 403
    });
  }

  // ------------------------------------------------------------
  // Discord PING
  // ------------------------------------------------------------

  if (interaction.type === 1) {
    console.log("Discord : PING reçu");

    return json({
      type: 1
    });
  }

  // ------------------------------------------------------------
  // Commandes slash
  // ------------------------------------------------------------

  if (interaction.type === 2) {
    return handleApplicationCommand(interaction, env);
  }

  console.log(
    "Discord : type d'interaction non pris en charge",
    interaction.type
  );

  return json(
    {
      error: "Interaction type not implemented"
    },
    400
  );
}


// ================================================================
// DISCORD — COMMANDES APPLICATION
// ================================================================

function handleApplicationCommand(interaction, env) {
  const commandName = interaction.data?.name;

  // ------------------------------------------------------------
  // Vérification du serveur DEV
  // ------------------------------------------------------------

  if (interaction.guild_id !== env.DISCORD_GUILD_ID) {
    console.error(
      "Discord : commande reçue depuis un serveur non autorisé",
      interaction.guild_id
    );

    return discordMessage(
      "Accès refusé : ce serveur Discord n'est pas autorisé.",
      true
    );
  }

  // ------------------------------------------------------------
  // Pour l'instant, seule /commune existe
  // ------------------------------------------------------------

  if (commandName !== "commune") {
    return discordMessage(
      "Cette commande n'est pas reconnue.",
      true
    );
  }

  // ------------------------------------------------------------
  // Récupération des rôles de l'utilisateur
  // ------------------------------------------------------------

  const memberRoles = interaction.member?.roles || [];

  const isAdmin =
    memberRoles.includes(env.DISCORD_ADMIN_ROLE_ID);

  const isModerator =
    memberRoles.includes(env.DISCORD_MODERATOR_ROLE_ID);

  const isZoneAdmin =
    interaction.member?.user?.id === DEV_ZONE_ADMIN_USER_ID;

  // ------------------------------------------------------------
  // Autorisation — Admin
  // ------------------------------------------------------------

  if (isAdmin) {
    console.log(
      "Discord : /commune autorisée — Admin",
      interaction.member?.user?.id
    );

    return discordMessage(
      [
        "**WPlace La Commune — Administration**",
        "",
        "Connexion au système d'administration opérationnelle.",
        "",
        "Niveau d'accès : **Admin**"
      ].join("\n"),
      true
    );
  }

  // ------------------------------------------------------------
  // Autorisation — Admin de zone DEV
  // ------------------------------------------------------------

  if (isZoneAdmin) {
    console.log(
      "Discord : /commune autorisée — Admin de zone DEV",
      interaction.member?.user?.id
    );

    return discordMessage(
      [
        "**WPlace La Commune — Administration**",
        "",
        "Connexion au système d'administration opérationnelle.",
        "",
        "Niveau d'accès : **Admin de zone (DEV)**"
      ].join("\n"),
      true
    );
  }

  // ------------------------------------------------------------
  // Autorisation — Modérateur
  // ------------------------------------------------------------

  if (isModerator) {
    console.log(
      "Discord : /commune autorisée — Modérateur",
      interaction.member?.user?.id
    );

    return discordMessage(
      [
        "**WPlace La Commune — Administration**",
        "",
        "Connexion au système d'administration opérationnelle.",
        "",
        "Niveau d'accès : **Modérateur**"
      ].join("\n"),
      true
    );
  }

  // ------------------------------------------------------------
  // Refus — aucun rôle autorisé
  // ------------------------------------------------------------

  console.warn(
    "Discord : /commune refusée — aucun rôle autorisé",
    interaction.member?.user?.id
  );

  return discordMessage(
    "Accès refusé : tu n'as pas les permissions nécessaires.",
    true
  );
}


// ================================================================
// DISCORD — RÉPONSE À UNE COMMANDE
// ================================================================

function discordMessage(content, ephemeral = false) {
  return json({
    type: 4,
    data: {
      content,
      flags: ephemeral ? 64 : 0
    }
  });
}


// ================================================================
// VÉRIFICATION SIGNATURE DISCORD
// ================================================================

async function verifyDiscordSignature(
  body,
  signatureHex,
  timestamp,
  publicKeyHex
) {
  try {
    if (!/^[0-9a-fA-F]+$/.test(signatureHex)) {
      return false;
    }

    if (!/^[0-9a-fA-F]+$/.test(publicKeyHex)) {
      return false;
    }

    if (signatureHex.length !== 128) {
      return false;
    }

    if (publicKeyHex.length !== 64) {
      return false;
    }

    const signature = hexToBytes(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);

    const key = await crypto.subtle.importKey(
      "raw",
      publicKey,
      {
        name: "Ed25519"
      },
      false,
      ["verify"]
    );

    const message = new TextEncoder().encode(
      timestamp + body
    );

    return await crypto.subtle.verify(
      {
        name: "Ed25519"
      },
      key,
      signature,
      message
    );
  } catch (error) {
    console.error(
      "Erreur vérification signature Discord:",
      error
    );

    return false;
  }
}


// ================================================================
// HEX → BYTES
// ================================================================

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(
      hex.substring(i * 2, i * 2 + 2),
      16
    );
  }

  return bytes;
}


// ================================================================
// PERMISSIONS ZONE STAFF — PR3 CANDIDAT
// ================================================================
// WPlace La Commune — candidat helper permissions Zone Staff
// PR suivant : permissions serveur pour Notes / Templates / futurs modules.
// Politique V1 :
//   admin            = global
//   moderator        = zone_moderators(zone)
//   manager          = zone_staff(zone, manager)
//   template_manager = zone_staff(zone, template_manager)
//   zone_admin       = conserve son traitement DEV existant ; ne pas élargir ici.
//
// Important : ce helper ne modifie pas session.access et ne transforme pas
// manager/template_manager en rôles globaux. Les droits sont évalués avec
// l'utilisateur + la zone concernée côté Worker/D1.

const ZONE_PERMISSION = Object.freeze({
  NOTES_MANAGE: "notes_manage",
  TEMPLATES_MANAGE: "templates_manage"
});

async function hasZoneStaffRole(db, zoneId, discordUserId, role) {
  if (!db || !Number.isInteger(Number(zoneId)) || Number(zoneId) <= 0) return false;
  if (!discordUserId || !role) return false;

  const row = await db.prepare(`
    SELECT 1
    FROM zone_staff
    WHERE zone_id = ?
      AND discord_user_id = ?
      AND role = ?
    LIMIT 1
  `).bind(Number(zoneId), String(discordUserId), role).first();

  return Boolean(row);
}

async function hasZoneModeratorRole(db, zoneId, discordUserId) {
  if (!db || !Number.isInteger(Number(zoneId)) || Number(zoneId) <= 0) return false;
  if (!discordUserId) return false;

  const row = await db.prepare(`
    SELECT 1
    FROM zone_moderators
    WHERE zone_id = ?
      AND discord_user_id = ?
    LIMIT 1
  `).bind(Number(zoneId), String(discordUserId)).first();

  return Boolean(row);
}

async function canManageZoneResource(db, session, zoneId, permission) {
  if (!session?.user?.id || !db) return false;
  if (!Number.isInteger(Number(zoneId)) || Number(zoneId) <= 0) return false;

  if (session.access === "admin") return true;

  switch (permission) {
    case ZONE_PERMISSION.NOTES_MANAGE:
      if (session.access === "moderator") {
        return hasZoneModeratorRole(db, zoneId, session.user.id);
      }
      if (session.access === "member") {
        return hasZoneStaffRole(db, zoneId, session.user.id, "manager");
      }
      return false;

    case ZONE_PERMISSION.TEMPLATES_MANAGE:
      if (session.access === "moderator") {
        return hasZoneModeratorRole(db, zoneId, session.user.id);
      }
      if (session.access === "member") {
        return hasZoneStaffRole(db, zoneId, session.user.id, "template_manager");
      }
      return false;

    default:
      return false;
  }
}

async function canManageNotes(db, session, zoneId) {
  return canManageZoneResource(db, session, zoneId, ZONE_PERMISSION.NOTES_MANAGE);
}

async function canManageTemplates(db, session, zoneId) {
  return canManageZoneResource(db, session, zoneId, ZONE_PERMISSION.TEMPLATES_MANAGE);
}


// ================================================================
// AUTHENTIFICATION DISCORD — OAUTH2
// ================================================================

const FRONTEND_ORIGIN_DEFAULT = "https://lacommune20.github.io";
const FRONTEND_URL_DEFAULT = "https://lacommune20.github.io/wplace-alliance/";

// DEV uniquement : accès zone-admin pour Egitos.
const DEV_ZONE_ADMIN_USER_ID = "668528773427232809";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_EXCHANGE_TTL_SECONDS = 60;

async function startDiscordOAuth(request, env) {
  if (!env.DISCORD_CLIENT_SECRET || !env.DISCORD_SESSION_SECRET) {
    return new Response("OAuth2 non configuré.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=UTF-8" }
    });
  }

  const url = new URL(request.url);
  const next = sanitizeOAuthNext(url.searchParams.get("next"), env);
  const state = randomToken(32);
  const stateCookie = await createOAuthStateCookie(state, next, env);

  const params = new URLSearchParams({
    client_id: env.DISCORD_APPLICATION_ID,
    response_type: "code",
    redirect_uri: getOAuthRedirectUri(env),
    scope: "identify",
    state
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://discord.com/oauth2/authorize?${params.toString()}`,
      "Set-Cookie": stateCookie
    }
  });
}

async function handleDiscordOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return redirectFrontend(env, "?auth=denied");

  if (!code || !state) {
    return new Response("Paramètres OAuth2 manquants.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=UTF-8" }
    });
  }

  const stateCookie = getCookie(request, "wplace_oauth_state");

  const stateData = stateCookie
    ? await verifyOAuthStateCookie(stateCookie, state, env)
    : null;

  if (!stateData) {
    return new Response("État OAuth2 invalide ou expiré.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=UTF-8" }
    });
  }

  const next = stateData.next;

  const token = await exchangeDiscordCode(code, env);
  if (!token?.access_token) {
    console.error("Discord OAuth2 : échange du code impossible");
    return redirectFrontend(env, "?auth=error");
  }

  const discordUser = await fetchDiscordUser(token.access_token);
  if (!discordUser?.id) {
    console.error("Discord OAuth2 : récupération de l'identité impossible");
    return redirectFrontend(env, "?auth=error");
  }

  // Vérification côté serveur avec le bot.
  // Le navigateur ne fournit jamais le statut de membre ou les rôles.
  const member = await fetchDiscordGuildMember(discordUser.id, env);

  if (!member) {
    return redirectFrontend(env, "?auth=not-member");
  }

  const roles = Array.isArray(member.roles) ? member.roles : [];

  const isAdmin = roles.includes(env.DISCORD_ADMIN_ROLE_ID);
  const isModerator = roles.includes(env.DISCORD_MODERATOR_ROLE_ID);
  const isZoneAdmin = discordUser.id === DEV_ZONE_ADMIN_USER_ID;

  const access = isAdmin
    ? "admin"
    : isZoneAdmin
      ? "zone_admin"
      : isModerator
        ? "moderator"
        : "member";

  const now = Math.floor(Date.now() / 1000);

  const session = {
    user: {
      id: discordUser.id,
      username: discordUser.username,
      global_name: discordUser.global_name || null
    },
    access,
    guild_id: env.DISCORD_GUILD_ID,
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  };

  const sessionValue = await createSessionValue(session, env);
  const target = new URL(next, getFrontendOrigin(env));
  target.searchParams.set("auth", "success");

  // #commune utilise un code d'échange opaque, court et à usage unique.
  // La carte principale conserve pour l'instant son ancien transport par fragment
  // afin de rester compatible pendant cette migration progressive.
  if (target.pathname.endsWith("/commune/") || target.pathname.endsWith("/commune/index.html")) {
    const exchangeCode = randomToken(32);
    await storeOAuthExchangeCode(exchangeCode, sessionValue, next, env);
    target.searchParams.set("code", exchangeCode);
  } else {
    target.hash = `wplace_session=${encodeURIComponent(sessionValue)}`;
  }

  const headers = new Headers();
  headers.set("Location", target.toString());
  headers.append("Set-Cookie", clearOAuthStateCookie());
  headers.append("Set-Cookie", sessionCookieFromValue(sessionValue));

  return new Response(null, {
    status: 302,
    headers
  });
}

async function exchangeAuthCode(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonAuth(request, { error: "Requête invalide" }, 400, env);
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code || code.length < 32 || code.length > 128) {
    return jsonAuth(request, { error: "Code d'échange invalide" }, 400, env);
  }

  try {
    const codeHash = await sha256Base64Url(code);
    const now = Math.floor(Date.now() / 1000);

    const record = await env.DB.prepare(`
      SELECT code_hash, session_value, next_path
      FROM oauth_exchange_codes
      WHERE code_hash = ?
        AND used_at IS NULL
        AND expires_at > ?
      LIMIT 1
    `).bind(codeHash, now).first();

    if (!record) {
      return jsonAuth(request, { error: "Code d'échange invalide ou expiré" }, 401, env);
    }

    const consumed = await env.DB.prepare(`
      UPDATE oauth_exchange_codes
      SET used_at = ?
      WHERE code_hash = ?
        AND used_at IS NULL
        AND expires_at > ?
    `).bind(now, codeHash, now).run();

    if (!consumed.meta?.changes) {
      return jsonAuth(request, { error: "Code d'échange déjà utilisé" }, 401, env);
    }

    await env.DB.prepare(`
      DELETE FROM oauth_exchange_codes
      WHERE expires_at <= ? OR used_at IS NOT NULL
    `).bind(now).run();

    return jsonAuth(request, {
      token: record.session_value,
      next: record.next_path || null
    }, 200, env);
  } catch (error) {
    console.error("Erreur /api/auth/exchange:", error);
    return jsonAuth(request, { error: "Erreur lors de l'échange du code" }, 500, env);
  }
}

async function storeOAuthExchangeCode(code, sessionValue, next, env) {
  const now = Math.floor(Date.now() / 1000);
  const codeHash = await sha256Base64Url(code);

  await env.DB.prepare(`
    INSERT INTO oauth_exchange_codes (code_hash, session_value, next_path, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    codeHash,
    sessionValue,
    sanitizeOAuthNext(next, env),
    now + OAUTH_EXCHANGE_TTL_SECONDS,
    now
  ).run();
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

async function exchangeDiscordCode(code, env) {
  const body = new URLSearchParams({
    client_id: env.DISCORD_APPLICATION_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: getOAuthRedirectUri(env)
  });

  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    console.error("Discord OAuth2 token:", response.status);
    return null;
  }

  return response.json();
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    console.error("Discord /users/@me:", response.status);
    return null;
  }

  return response.json();
}

async function fetchDiscordGuildMember(userId, env) {
  if (!env.DISCORD_BOT_TOKEN) {
    console.error("DISCORD_BOT_TOKEN manquant");
    return null;
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
      }
    }
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    console.error("Discord guild member:", response.status);
    return null;
  }

  return response.json();
}

// ================================================================
// SESSIONS SIGNÉES
// ================================================================

async function createSessionValue(session, env) {
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(session))
  );

  const signature = await hmacSign(payload, env.DISCORD_SESSION_SECRET);
  return `${payload}.${signature}`;
}

function sessionCookieFromValue(value) {
  return [
    `wplace_session=${value}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=None"
  ].join("; ");
}

async function getSession(request, env) {
  let raw = getBearerToken(request);
  if (!raw) raw = getCookie(request, "wplace_session");

  if (!raw || !env.DISCORD_SESSION_SECRET) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  if (!(await hmacVerify(payload, signature, env.DISCORD_SESSION_SECRET))) {
    return null;
  }

  try {
    const session = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payload))
    );

    const now = Math.floor(Date.now() / 1000);

    if (
      !session ||
      !session.user?.id ||
      session.guild_id !== env.DISCORD_GUILD_ID ||
      !Number.isInteger(session.exp) ||
      session.exp <= now ||
      !["member", "moderator", "admin", "zone_admin"].includes(session.access)
    ) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

async function requireMember(request, env) {
  return getSession(request, env);
}

async function requireAdmin(request, env) {
  const session = await getSession(request, env);
  return session?.access === "admin" ? session : null;
}

async function requireAdminOrModerator(request, env) {
  const session = await getSession(request, env);
  return session && ["admin", "moderator", "zone_admin"].includes(session.access)
    ? session
    : null;
}

async function createOAuthStateCookie(state, next, env) {
  const expires = Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS;
  const value = `${state}.${expires}.${encodeURIComponent(next)}`;
  const signature = await hmacSign(value, env.DISCORD_SESSION_SECRET);
  const encoded = base64UrlEncode(
    new TextEncoder().encode(`${value}.${signature}`)
  );

  return [
    `wplace_oauth_state=${encoded}`,
    "Path=/auth/discord",
    `Max-Age=${OAUTH_STATE_TTL_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

async function verifyOAuthStateCookie(cookieValue, expectedState, env) {
  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(cookieValue));
    const parts = decoded.split(".");

    if (parts.length !== 4) return null;

    const [state, expiresText, nextEncoded, signature] = parts;
    const expires = Number(expiresText);

    if (
      !state ||
      state !== expectedState ||
      !nextEncoded ||
      !Number.isInteger(expires) ||
      expires <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    const value = `${state}.${expires}.${nextEncoded}`;
    const valid = await hmacVerify(
      value,
      signature,
      env.DISCORD_SESSION_SECRET
    );

    if (!valid) return null;

    const next = sanitizeOAuthNext(decodeURIComponent(nextEncoded), env);
    return { next };
  } catch {
    return false;
  }
}

async function hmacSign(value, secret) {
  if (!secret) throw new Error("DISCORD_SESSION_SECRET manquant");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

async function hmacVerify(value, signature, secret) {
  if (!secret || !signature) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    return crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signature),
      new TextEncoder().encode(value)
    );
  } catch {
    return false;
  }
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes) {
  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1) continue;

    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();

    if (key === name) return value;
  }

  return null;
}

function normalizeCategorySlug(value) {
  const slug = String(value || "").trim().toLowerCase();

  // Compatibilité avec les anciennes valeurs envoyées par le frontend DEV.
  if (slug === "allie") return "sympathisant";
  if (slug === "neutre") return "allie-neutre";

  return slug;
}

async function writeAdminLog(env, actorDiscordId, action, targetType, targetId, result, reason, metadata = {}) {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_logs (actor_discord_id, action, target_type, target_id, result, reason, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      actorDiscordId,
      action,
      targetType,
      targetId,
      result,
      reason,
      JSON.stringify(metadata),
      Math.floor(Date.now() / 1000)
    ).run();
  } catch (error) {
    console.error("Erreur journal d'administration:", error);
  }
}

function clearOAuthStateCookie() {
  return "wplace_oauth_state=; Path=/auth/discord; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

function sanitizeOAuthNext(value, env) {
  const fallback = new URL(getFrontendUrl(env)).pathname;

  if (!value) return fallback;

  try {
    const candidate = new URL(value, getFrontendOrigin(env));
    const origin = getFrontendOrigin(env).replace(/\/$/, "");
    if (candidate.origin !== origin) return fallback;

    const basePath = new URL(getFrontendUrl(env)).pathname;
    if (!candidate.pathname.startsWith(basePath)) return fallback;

    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return fallback;
  }
}

function getFrontendOrigin(env) {
  return env.FRONTEND_ORIGIN || FRONTEND_ORIGIN_DEFAULT;
}

function getFrontendUrl(env) {
  return env.FRONTEND_URL || FRONTEND_URL_DEFAULT;
}

function getOAuthRedirectUri(env) {
  return env.DISCORD_OAUTH_REDIRECT_URI ||
    "https://wplace-commune-api-dev.mathieu-peter.workers.dev/auth/discord/callback";
}

function redirectFrontend(env, path) {
  const target = new URL(path || "", getFrontendUrl(env));
  const headers = new Headers();
  headers.set("Location", target.toString());
  headers.append("Set-Cookie", clearOAuthStateCookie());

  return new Response(null, {
    status: 302,
    headers
  });
}




// ================================================================
// RADAR DEV — BASELINE PERSISTANT
// ================================================================

const RADAR_PROXY_DEFAULT_BASE_URL = "https://wplace-commune-proxy.mathieu-peter.workers.dev";
const RADAR_WORLD_TILE_SIZE = 1000;
const RADAR_WORLD_SIZE = 2048000;

function radarParseJsonInline(value, label) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw new Error(`${label} JSON invalide`); }
}

function radarNormalizeStoredZonePolygonInline(value) {
  const polygon = radarParseJsonInline(value, "Polygone de zone");
  if (!Array.isArray(polygon) || polygon.length < 3) throw new Error("Polygone de zone invalide");
  return polygon.map(point => {
    if (!Array.isArray(point) || point.length < 2) throw new Error("Sommet de polygone de zone invalide");
    const lat = Number(point[0]);
    const lng = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("Coordonnée du polygone de zone invalide");
    }
    return [lng, lat];
  });
}

function radarEnumerateTilesForBoundsInline(bounds) {
  const minTileX = Math.floor(bounds.minX / RADAR_WORLD_TILE_SIZE);
  const maxTileX = Math.floor(bounds.maxX / RADAR_WORLD_TILE_SIZE);
  const minTileY = Math.floor(bounds.minY / RADAR_WORLD_TILE_SIZE);
  const maxTileY = Math.floor(bounds.maxY / RADAR_WORLD_TILE_SIZE);
  const tiles = [];
  for (let y = minTileY; y <= maxTileY; y += 1) {
    for (let x = minTileX; x <= maxTileX; x += 1) tiles.push({ tileX: x, tileY: y });
  }
  return tiles;
}

function radarLngLatToWorldInline(lng, lat) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * RADAR_WORLD_SIZE,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * RADAR_WORLD_SIZE
  };
}

function radarPointInPolygonInline(point, ring) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function radarOrientationInline(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function radarOnSegmentInline(a, b, p) {
  return p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}

function radarSegmentsIntersectInline(a, b, c, d) {
  const o1 = radarOrientationInline(a, b, c); const o2 = radarOrientationInline(a, b, d);
  const o3 = radarOrientationInline(c, d, a); const o4 = radarOrientationInline(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && radarOnSegmentInline(a, b, c)) return true;
  if (o2 === 0 && radarOnSegmentInline(a, b, d)) return true;
  if (o3 === 0 && radarOnSegmentInline(c, d, a)) return true;
  if (o4 === 0 && radarOnSegmentInline(c, d, b)) return true;
  return false;
}

function radarPolygonIntersectsRectInline(ring, rect) {
  const corners = [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.maxX, rect.maxY], [rect.minX, rect.maxY]];
  if (ring.some(([x, y]) => x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY)) return true;
  if (corners.some(corner => radarPointInPolygonInline(corner, ring))) return true;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    for (let j = 0; j < corners.length; j += 1) {
      if (radarSegmentsIntersectInline(a, b, corners[j], corners[(j + 1) % corners.length])) return true;
    }
  }
  return false;
}

function radarTilesForPolygonInline(polygon) {
  const worldRing = polygon.map(([lng, lat]) => {
    const point = radarLngLatToWorldInline(lng, lat); return [point.x, point.y];
  });
  const bounds = worldRing.reduce((acc, [x, y]) => ({
    minX: Math.min(acc.minX, x), minY: Math.min(acc.minY, y), maxX: Math.max(acc.maxX, x), maxY: Math.max(acc.maxY, y)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  return radarEnumerateTilesForBoundsInline(bounds).filter(tile => radarPolygonIntersectsRectInline(worldRing, {
    minX: tile.tileX * RADAR_WORLD_TILE_SIZE, minY: tile.tileY * RADAR_WORLD_TILE_SIZE,
    maxX: (tile.tileX + 1) * RADAR_WORLD_TILE_SIZE, maxY: (tile.tileY + 1) * RADAR_WORLD_TILE_SIZE
  }));
}

function radarTilesForRectangleInline(geometry) {
  const rectangle = radarParseJsonInline(geometry, "Rectangle");
  if (!rectangle || typeof rectangle !== "object") throw new Error("Rectangle invalide");
  const west = Number(rectangle.west ?? rectangle.minLng ?? rectangle.minLon);
  const south = Number(rectangle.south ?? rectangle.minLat);
  const east = Number(rectangle.east ?? rectangle.maxLng ?? rectangle.maxLon);
  const north = Number(rectangle.north ?? rectangle.maxLat);
  if (![west, south, east, north].every(Number.isFinite) || west > east || south > north || west < -180 || east > 180 || south < -90 || north > 90) {
    throw new Error("Rectangle géographique invalide");
  }
  const worldWest = ((west + 180) / 360) * RADAR_WORLD_SIZE;
  const worldEast = ((east + 180) / 360) * RADAR_WORLD_SIZE;
  const projectY = lat => {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const sin = Math.sin((clamped * Math.PI) / 180);
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * RADAR_WORLD_SIZE;
  };
  const ySouth = projectY(south); const yNorth = projectY(north);
  return radarEnumerateTilesForBoundsInline({ minX: Math.min(worldWest, worldEast), minY: Math.min(yNorth, ySouth), maxX: Math.max(worldWest, worldEast), maxY: Math.max(yNorth, ySouth) });
}

async function loadRadarRuntimeConfigInline(db, radarId) {
  const id = String(radarId || "").trim();
  if (!id) throw new Error("radar_id requis");
  const radar = await db.prepare(`
    SELECT r.id, r.zone_id, r.created_by, r.type, r.geometry, r.status,
           r.scan_interval_seconds, r.notification_mode, r.alert_threshold, r.urgency_threshold,
           z.slug AS zone_slug, z.name AS zone_name, z.status AS zone_status, z.polygon AS zone_polygon
    FROM radars r INNER JOIN zones z ON z.id = r.zone_id WHERE r.id = ? LIMIT 1
  `).bind(id).first();
  if (!radar) throw new Error("Radar introuvable");
  if (!["active", "paused"].includes(radar.status)) throw new Error("Radar inactif ou archivé");
  if (radar.zone_status !== "active") throw new Error("Zone du Radar inactive ou archivée");
  const zone = { id: Number(radar.zone_id), slug: radar.zone_slug, name: radar.zone_name, status: radar.zone_status };
  let scope;
  if (radar.type === "zone") {
    const polygon = radarNormalizeStoredZonePolygonInline(radar.zone_polygon);
    scope = { type: "zone", zoneId: zone.id, polygon, tiles: radarTilesForPolygonInline(polygon) };
  } else if (radar.type === "rectangle") {
    scope = { type: "rectangle", zoneId: zone.id, tiles: radarTilesForRectangleInline(radar.geometry) };
  } else throw new Error("Type de radar invalide");
  if (!scope.tiles.length) throw new Error("Le scope du Radar ne contient aucune tuile");
  return { radar, zone, scope };
}

function isRadarScanDue(radar, now = Date.now()) {
  if (!radar || typeof radar !== "object") {
    return {
      due: false,
      reason: "radar_missing"
    };
  }

  const status = String(radar.status || "").trim().toLowerCase();

  if (status !== "active") {
    return {
      due: false,
      reason: "radar_not_active"
    };
  }

  const interval = Number(radar.scan_interval_seconds);

  if (!Number.isInteger(interval) || interval < 60) {
    return {
      due: false,
      reason: "invalid_scan_interval"
    };
  }

  if (!radar.last_scan_at) {
    return {
      due: true,
      reason: "never_scanned",
      elapsed_seconds: null,
      interval_seconds: interval
    };
  }

  const lastScan = Date.parse(radar.last_scan_at);

  if (!Number.isFinite(lastScan)) {
    return {
      due: true,
      reason: "invalid_last_scan_at",
      elapsed_seconds: null,
      interval_seconds: interval
    };
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - lastScan) / 1000));

  return {
    due: elapsedSeconds >= interval,
    reason: elapsedSeconds >= interval ? "interval_elapsed" : "interval_not_elapsed",
    elapsed_seconds: elapsedSeconds,
    interval_seconds: interval,
    next_scan_in_seconds: Math.max(0, interval - elapsedSeconds)
  };
}

function radarTileKey(tileX, tileY) {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0) {
    throw new Error("Coordonnées de tuile invalides");
  }
  return `${tileX}/${tileY}`;
}

function radarSafeSegment(value) {
  return encodeURIComponent(String(value));
}

function radarCommittedPrefix(radarId, version) {
  return `baselines/${radarSafeSegment(radarId)}/${radarSafeSegment(version)}`;
}

function radarCommittedTileKey(radarId, version, tileX, tileY) {
  return `${radarCommittedPrefix(radarId, version)}/tiles/${radarTileKey(tileX, tileY)}.png`;
}

function radarCandidatePrefix(radarId, version) {
  return `baselines/${radarSafeSegment(radarId)}/${radarSafeSegment(version)}`;
}

function radarCandidateManifestKey(candidate) {
  return `${radarCandidatePrefix(candidate.radarId, candidate.version)}/manifest.json`;
}

function radarCandidateTileKey(candidate, tileX, tileY) {
  return `${radarCandidatePrefix(candidate.radarId, candidate.version)}/tiles/${radarTileKey(tileX, tileY)}.png`;
}

function radarNewId() {
  return crypto.randomUUID();
}

async function sha256Hex(bytes) {
  const buffer = bytes instanceof Uint8Array
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : bytes;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchRadarProxyTile(env, tileX, tileY) {
  const url = `${RADAR_PROXY_DEFAULT_BASE_URL}/radar-tile/${tileX}/${tileY}.png?radar_ts=${Date.now()}`;

  if (!env?.RADAR_PROXY || typeof env.RADAR_PROXY.fetch !== "function") {
    throw new Error("Binding RADAR_PROXY manquant ou invalide");
  }

  const response = await env.RADAR_PROXY.fetch(
    new Request(url, {
      method: "GET",
      headers: {
        Accept: "image/png,image/*;q=0.8"
      },
      cache: "no-store"
    })
  );

  if (!response.ok) {
    throw new Error(`Tuile Radar ${tileX}/${tileY}: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("image/png")) {
    throw new Error(`Tuile Radar ${tileX}/${tileY}: Content-Type inattendu (${contentType || "absent"})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength < 8 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    throw new Error(`Tuile Radar ${tileX}/${tileY}: contenu non-PNG`);
  }

  return { tileX, tileY, bytes, contentType };
}

async function getRadarCurrentBaseline(db, radarId) {
  return db.prepare(`
    SELECT id, radar_id, version, expected_tile_count, committed_at
    FROM radar_baselines
    WHERE radar_id = ? AND current = 1
    LIMIT 1
  `).bind(radarId).first();
}

async function createRadarCandidate(env, radarId, tiles) {
  const id = radarNewId();
  const version = `${Date.now()}-${id}`;
  const expectedTiles = [...new Set(tiles.map(tile => radarTileKey(tile.tileX, tile.tileY)))].sort();
  const manifestKey = `${radarCandidatePrefix(radarId, version)}/manifest.json`;
  const createdAt = new Date().toISOString();

  await env.RADAR_BUCKET.put(manifestKey, JSON.stringify({
    radarId,
    version,
    expectedTiles,
    tileSize: RADAR_WORLD_TILE_SIZE,
    createdAt
  }), {
    httpMetadata: { contentType: "application/json" }
  });

  try {
    await env.DB.prepare(`
      INSERT INTO radar_baselines
        (id, radar_id, version, status, expected_tile_count, manifest_key, current, created_at, committed_at)
      VALUES (?, ?, ?, 'candidate', ?, ?, 0, ?, NULL)
    `).bind(
      id,
      radarId,
      version,
      expectedTiles.length,
      manifestKey,
      createdAt
    ).run();
  } catch (error) {
    await env.RADAR_BUCKET.delete(manifestKey);
    throw error;
  }

  return { id, radarId, version, expectedTiles, manifestKey };
}

async function putRadarCandidateTile(env, candidate, tile, bytes) {
  if (!candidate.expectedTiles.includes(radarTileKey(tile.tileX, tile.tileY))) {
    throw new Error(`Tuile ${tile.tileX}/${tile.tileY} absente du candidat`);
  }
  await env.RADAR_BUCKET.put(radarCandidateTileKey(candidate, tile.tileX, tile.tileY), bytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: {
      tileX: String(tile.tileX),
      tileY: String(tile.tileY),
      source: "wplace-radar-dev"
    }
  });
}

async function listRadarCandidateTileKeys(env, candidate) {
  const prefix = `${radarCandidatePrefix(candidate.radarId, candidate.version)}/tiles/`;
  const keys = [];
  let cursor;
  do {
    const page = await env.RADAR_BUCKET.list({ prefix, limit: 1000, cursor });
    keys.push(...page.objects.map(object => object.key.slice(prefix.length).replace(/\.png$/, "")));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys.sort();
}

async function finalizeRadarCandidate(env, candidate) {
  const row = await env.DB.prepare(`
    SELECT status, expected_tile_count, manifest_key
    FROM radar_baselines
    WHERE id = ?
    LIMIT 1
  `).bind(candidate.id).first();

  if (!row || row.status !== "candidate") throw new Error("Candidat Radar invalide ou déjà finalisé");

  const manifestObject = await env.RADAR_BUCKET.get(row.manifest_key);
  if (!manifestObject) throw new Error("Manifest Radar introuvable");
  const manifest = JSON.parse(await manifestObject.text());
  const actual = await listRadarCandidateTileKeys(env, candidate);
  const expected = [...manifest.expectedTiles].sort();

  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Candidat Radar incomplet: ${actual.length}/${expected.length} tuiles présentes`);
  }

  await env.DB.prepare(`
    UPDATE radar_baselines
    SET status = 'finalized'
    WHERE id = ? AND status = 'candidate'
  `).bind(candidate.id).run();
}

async function commitRadarCandidate(env, candidate) {
  const row = await env.DB.prepare(`
    SELECT status, expected_tile_count
    FROM radar_baselines
    WHERE id = ?
    LIMIT 1
  `).bind(candidate.id).first();

  if (!row || row.status !== "finalized") throw new Error("Candidat Radar non finalisé");

  const committedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE radar_baselines
      SET current = 0
      WHERE radar_id = ? AND current = 1
    `).bind(candidate.radarId),
    env.DB.prepare(`
      UPDATE radar_baselines
      SET status = 'committed', current = 1, committed_at = ?
      WHERE id = ? AND status = 'finalized'
    `).bind(committedAt, candidate.id)
  ]);

  return {
    version: candidate.version,
    expected_tile_count: row.expected_tile_count,
    committed_at: committedAt
  };
}

async function deleteRadarPrefix(env, prefix) {
  let cursor;
  do {
    const page = await env.RADAR_BUCKET.list({ prefix, limit: 1000, cursor });
    if (page.objects.length) await env.RADAR_BUCKET.delete(page.objects.map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function abortRadarCandidate(env, candidate) {
  await deleteRadarPrefix(env, radarCandidatePrefix(candidate.radarId, candidate.version));
  await env.DB.prepare(`
    UPDATE radar_baselines
    SET status = 'aborted', current = 0
    WHERE id = ? AND status IN ('candidate', 'finalized')
  `).bind(candidate.id).run();
}


// ================================================================
// RADAR DEV — PIXEL DIFF + EVENT LIFECYCLE
// Bundled Worker runtime helpers. Mirrors the pure Radar Lab contracts.
// ================================================================

const RADAR_EVENT_PROXIMITY_PIXELS = 32;
const RADAR_EVENT_QUIET_AFTER_MS = 5 * 60 * 1000;
const RADAR_EVENT_CLOSE_AFTER_MS = 15 * 60 * 1000;
const RADAR_EVENT_REOPEN_AFTER_MS = RADAR_EVENT_CLOSE_AFTER_MS;

function radarFiniteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function radarWorldBounds(region) {
  const tileX = radarFiniteNumber(region.tile_x ?? region.tileX);
  const tileY = radarFiniteNumber(region.tile_y ?? region.tileY);
  const minX = radarFiniteNumber(region.min_x ?? region.minX);
  const minY = radarFiniteNumber(region.min_y ?? region.minY);
  const maxX = radarFiniteNumber(region.max_x ?? region.maxX);
  const maxY = radarFiniteNumber(region.max_y ?? region.maxY);
  return {
    minX: tileX * 1000 + minX,
    minY: tileY * 1000 + minY,
    maxX: tileX * 1000 + maxX,
    maxY: tileY * 1000 + maxY
  };
}

function radarAxisGap(aMin, aMax, bMin, bMax) {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

function radarRegionsAreClose(a, b, proximityPixels = RADAR_EVENT_PROXIMITY_PIXELS) {
  const left = radarWorldBounds(a);
  const right = radarWorldBounds(b);
  const dx = radarAxisGap(left.minX, left.maxX, right.minX, right.maxX);
  const dy = radarAxisGap(left.minY, left.maxY, right.minY, right.maxY);
  return Math.hypot(dx, dy) <= proximityPixels;
}

function radarGroupRegionsByProximity(regions = [], proximityPixels = RADAR_EVENT_PROXIMITY_PIXELS) {
  const remaining = regions.map((_, index) => index);
  const groups = [];

  while (remaining.length) {
    const seed = remaining.shift();
    const groupIndexes = [seed];
    const queue = [seed];

    while (queue.length) {
      const current = queue.shift();
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const candidate = remaining[i];
        if (!radarRegionsAreClose(regions[current], regions[candidate], proximityPixels)) continue;
        remaining.splice(i, 1);
        groupIndexes.push(candidate);
        queue.push(candidate);
      }
    }

    groups.push(groupIndexes.map(index => regions[index]));
  }

  return groups;
}

function radarObservationForRegionGroup(observation, regions) {
  const regionPixels = regions.reduce(
    (sum, region) => sum + radarFiniteNumber(region.pixel_count ?? region.pixelCount),
    0
  );
  const totalMeaningful = radarFiniteNumber(
    observation.summary?.changedMeaningfulPixels ?? observation.summary?.changedPixels
  );
  const changedMeaningfulPixels = regionPixels > 0 ? regionPixels : totalMeaningful;
  const changedPixels = regionPixels > 0 ? regionPixels : totalMeaningful;

  return {
    ...observation,
    regions,
    summary: {
      ...(observation.summary ?? {}),
      changedPixels,
      changedMeaningfulPixels,
      regionCount: regions.length
    }
  };
}

function radarEventMatchesRegions(eventRegions = [], incomingRegions = [], proximityPixels = RADAR_EVENT_PROXIMITY_PIXELS) {
  if (!eventRegions.length || !incomingRegions.length) return false;
  return incomingRegions.some(incoming =>
    eventRegions.some(existing => radarRegionsAreClose(existing, incoming, proximityPixels))
  );
}

function radarEventLastActivityMs(event) {
  const value = event.last_activity_at ?? event.lastActivityAt;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function radarEventStatus(event) {
  return event.status ?? "active";
}

function resolveRadarObservationWorker({ radarId, zoneId = null, observation, events = [], now = Date.now() }) {
  if (!observation || !observation.changed) return { action: "none", event: null, regions: [] };

  const seenAt = typeof now === "string" ? now : new Date(now).toISOString();
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const incomingRegions = observation.regions ?? [];

  const matchingEvent = events
    .filter(event => {
      const status = radarEventStatus(event);
      if (status === "closed") return false;
      const lastActivity = radarEventLastActivityMs(event);
      return Number.isFinite(lastActivity) && Number.isFinite(nowMs) &&
        nowMs - lastActivity <= RADAR_EVENT_REOPEN_AFTER_MS;
    })
    .filter(event => radarEventMatchesRegions(event.regions ?? [], incomingRegions))
    .sort((a, b) => radarEventLastActivityMs(b) - radarEventLastActivityMs(a))[0] ?? null;

  const changedPixels = radarFiniteNumber(
    observation.summary?.changedMeaningfulPixels ?? observation.summary?.changedPixels
  );

  if (!matchingEvent) {
    return {
      action: "create",
      event: {
        radar_id: radarId,
        zone_id: zoneId,
        started_at: seenAt,
        last_activity_at: seenAt,
        closed_at: null,
        status: "active",
        pixel_count: changedPixels,
        region_count: incomingRegions.length,
        score: radarFiniteNumber(observation.score, 0),
        score_breakdown: observation.summary ?? null
      },
      regions: incomingRegions
    };
  }

  return {
    action: "update",
    event: {
      ...matchingEvent,
      zone_id: matchingEvent.zone_id ?? zoneId,
      last_activity_at: seenAt,
      status: "active",
      closed_at: null,
      pixel_count: radarFiniteNumber(matchingEvent.pixel_count) + changedPixels,
      region_count: radarFiniteNumber(matchingEvent.region_count) + incomingRegions.length,
      score: radarFiniteNumber(observation.score, 0),
      score_breakdown: observation.summary ?? null
    },
    regions: incomingRegions,
    matchedEventId: matchingEvent.id ?? null
  };
}

function resolveRadarEventExpirationsWorker(events = [], now = Date.now()) {
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const nowIso = typeof now === "string" ? now : new Date(now).toISOString();

  return events
    .filter(event => radarEventStatus(event) !== "closed")
    .map(event => {
      const lastActivity = radarEventLastActivityMs(event);
      if (!Number.isFinite(lastActivity) || !Number.isFinite(nowMs)) return { action: "none", event };
      const age = nowMs - lastActivity;
      if (age >= RADAR_EVENT_CLOSE_AFTER_MS) {
        return { action: "close", event: { ...event, status: "closed", closed_at: nowIso } };
      }
      if (age >= RADAR_EVENT_QUIET_AFTER_MS && radarEventStatus(event) === "active") {
        return { action: "quiet", event: { ...event, status: "quiet" } };
      }
      return { action: "none", event };
    })
    .filter(result => result.action !== "none");
}

function radarSamePixel(a, b, offset) {
  return a[offset] === b[offset] && a[offset + 1] === b[offset + 1] &&
    a[offset + 2] === b[offset + 2] && a[offset + 3] === b[offset + 3];
}

function radarCompareTiles(previous, current) {
  if (!previous || !current) throw new Error("Deux états de tuile sont nécessaires");
  if (previous.width !== current.width || previous.height !== current.height) {
    throw new Error("Dimensions de tuiles incompatibles");
  }
  const pixelCount = current.width * current.height;
  if (previous.rgba.length !== pixelCount * 4 || current.rgba.length !== pixelCount * 4) {
    throw new Error("Buffer RGBA invalide");
  }

  const changed = new Uint8Array(pixelCount);
  let changedPixels = 0;
  let changedMeaningfulPixels = 0;
  let minX = current.width;
  let minY = current.height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (radarSamePixel(previous.rgba, current.rgba, offset)) continue;
    changed[index] = 1;
    changedPixels += 1;
    if (current.rgba[offset + 3] !== 0) changedMeaningfulPixels += 1;
    const x = index % current.width;
    const y = Math.floor(index / current.width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    width: current.width,
    height: current.height,
    changed,
    changedPixels,
    changedMeaningfulPixels,
    bounds: changedPixels ? { minX, minY, maxX, maxY } : null
  };
}

function radarFindChangedRegions(diff, options = {}) {
  const { width, height, changed } = diff;
  const maxRegions = options.maxRegions ?? 128;
  const minPixels = options.minPixels ?? 2;
  if (changed.length !== width * height) throw new Error("Masque de changement invalide");

  const queue = new Int32Array(width * height);
  const visited = new Uint8Array(width * height);
  const regions = [];

  for (let start = 0; start < changed.length; start += 1) {
    if (!changed[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let pixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      pixelCount += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const n = index - 1;
        if (changed[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
      if (x + 1 < width) {
        const n = index + 1;
        if (changed[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
      if (y > 0) {
        const n = index - width;
        if (changed[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
      if (y + 1 < height) {
        const n = index + width;
        if (changed[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n; }
      }
    }

    if (pixelCount >= minPixels) {
      regions.push({ pixelCount, minX, minY, maxX, maxY });
      if (regions.length >= maxRegions) break;
    }
  }

  regions.sort((a, b) => b.pixelCount - a.pixelCount);
  return regions;
}

function radarAnalyzeTileChange(previous, current, options = {}) {
  const diff = radarCompareTiles(previous, current);
  if (diff.changedPixels === 0) {
    return { changed: false, severity: "none", diff, regions: [], summary: radarSummarizeDiff(diff, []) };
  }
  const regions = radarFindChangedRegions(diff, {
    maxRegions: options.maxRegions ?? 128,
    minPixels: options.minRegionPixels ?? 2
  });
  const summary = radarSummarizeDiff(diff, regions);
  const alertThreshold = options.alertThreshold ?? Infinity;
  const urgencyThreshold = options.urgencyThreshold ?? Infinity;
  const score = Math.round(
    summary.changedMeaningfulPixels * (options.pixelWeight ?? 1) +
    summary.regionCount * (options.regionWeight ?? 20) +
    (summary.bounds
      ? summary.changedMeaningfulPixels /
        Math.max(1, (summary.bounds.maxX - summary.bounds.minX + 1) * (summary.bounds.maxY - summary.bounds.minY + 1))
      : 0) * (options.densityWeight ?? 50)
  );
  let severity = "observation";
  if (score >= urgencyThreshold) severity = "urgent";
  else if (score >= alertThreshold) severity = "alert";
  return { changed: true, severity, score, diff, regions, summary };
}

function radarSummarizeDiff(diff, regions) {
  return {
    changedPixels: diff.changedPixels,
    changedMeaningfulPixels: diff.changedMeaningfulPixels,
    regionCount: regions.length,
    bounds: diff.bounds,
    largestRegion: regions[0] || null,
    regionPixels: regions.reduce((sum, region) => sum + region.pixelCount, 0)
  };
}

// Minimal non-interlaced PNG decoder matching Radar Lab's supported WPlace formats.
const RADAR_PNG_SIGNATURE = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
function radarEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
function radarPaeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
async function radarInflate(data) {
  if (typeof DecompressionStream !== "function") throw new Error("DecompressionStream indisponible");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function radarPngChunks(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 || !radarEqualBytes(bytes.subarray(0, 8), RADAR_PNG_SIGNATURE)) throw new Error("Réponse non-PNG");
  const view = new DataView(buffer);
  let offset = 8;
  const chunks = [];
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset+4],bytes[offset+5],bytes[offset+6],bytes[offset+7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > bytes.length) throw new Error(`Chunk PNG tronqué: ${type}`);
    chunks.push({ type, data: bytes.slice(dataStart, dataEnd) });
    offset = crcEnd;
    if (type === "IEND") break;
  }
  return chunks;
}
function radarReadPalette(chunks) {
  const chunk = chunks.find(item => item.type === "PLTE");
  if (!chunk) return null;
  if (chunk.data.length % 3 !== 0) throw new Error("Palette PNG invalide");
  const palette = [];
  for (let i = 0; i < chunk.data.length; i += 3) palette.push([chunk.data[i],chunk.data[i+1],chunk.data[i+2],255]);
  const transparency = chunks.find(item => item.type === "tRNS");
  if (transparency) for (let i = 0; i < transparency.data.length && i < palette.length; i += 1) palette[i][3] = transparency.data[i];
  return palette;
}
function radarUnpackSample(row, bitDepth, index) {
  if (bitDepth === 8) return row[index];
  const perByte = 8 / bitDepth;
  const byteIndex = Math.floor(index / perByte);
  const shift = 8 - bitDepth * ((index % perByte) + 1);
  return (row[byteIndex] >> shift) & ((1 << bitDepth) - 1);
}
function radarScaleSample(value, bitDepth) { return Math.round((value * 255) / ((1 << bitDepth) - 1)); }
function radarReconstructRows(filtered, height, bytesPerPixel, rowBytes) {
  const output = new Uint8Array(height * rowBytes);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++];
    if (sourceOffset + rowBytes > filtered.length) throw new Error("Données PNG IDAT insuffisantes");
    const rowStart = y * rowBytes;
    const previousStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? output[rowStart+x-bytesPerPixel] : 0;
      const up = y > 0 ? output[previousStart+x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? output[previousStart+x-bytesPerPixel] : 0;
      let value;
      switch (filter) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + Math.floor((left + up) / 2); break;
        case 4: value = raw + radarPaeth(left, up, upLeft); break;
        default: throw new Error(`Filtre PNG inconnu: ${filter}`);
      }
      output[rowStart+x] = value & 255;
    }
    sourceOffset += rowBytes;
  }
  return output;
}
async function radarDecodePng(buffer) {
  const chunks = radarPngChunks(buffer);
  const ihdr = chunks.find(item => item.type === "IHDR");
  if (!ihdr || ihdr.data.length !== 13) throw new Error("IHDR PNG absent ou invalide");
  const view = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = view.getUint32(0), height = view.getUint32(4);
  const bitDepth = ihdr.data[8], colorType = ihdr.data[9];
  if (!width || !height || ihdr.data[10] !== 0 || ihdr.data[11] !== 0 || ihdr.data[12] !== 0) throw new Error("PNG non supporté");
  if (![0,2,3,4,6].includes(colorType)) throw new Error(`Type PNG non supporté: ${colorType}`);
  if (![1,2,4,8].includes(bitDepth) || (colorType === 2 && bitDepth !== 8) || (colorType === 4 && bitDepth !== 8) || (colorType === 6 && bitDepth !== 8)) throw new Error("Combinaison PNG non supportée");
  const channels = {0:1,2:3,3:1,4:2,6:4}[colorType];
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(channels * bitDepth / 8));
  const parts = chunks.filter(item => item.type === "IDAT").map(item => item.data);
  const compressed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { compressed.set(part, offset); offset += part.length; }
  const rows = radarReconstructRows(await radarInflate(compressed), height, bytesPerPixel, rowBytes);
  const palette = radarReadPalette(chunks);
  const rgba = new Uint8Array(width * height * 4);
  let sourceOffset = 0, targetOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const row = rows.subarray(sourceOffset, sourceOffset + rowBytes);
    sourceOffset += rowBytes;
    for (let x = 0; x < width; x += 1) {
      let r=0,g=0,b=0,a=255;
      if (colorType === 6) { const base=x*4; r=row[base];g=row[base+1];b=row[base+2];a=row[base+3]; }
      else if (colorType === 2) { const base=x*3; r=row[base];g=row[base+1];b=row[base+2]; }
      else if (colorType === 4) { const base=x*2; r=g=b=row[base];a=row[base+1]; }
      else if (colorType === 3) { const index=radarUnpackSample(row,bitDepth,x); const color=palette?.[index]; if(!color) throw new Error(`Index palette PNG invalide: ${index}`); [r,g,b,a]=color; }
      else { const sample=radarUnpackSample(row,bitDepth,x); r=g=b=radarScaleSample(sample,bitDepth); }
      rgba[targetOffset++]=r; rgba[targetOffset++]=g; rgba[targetOffset++]=b; rgba[targetOffset++]=a;
    }
  }
  return { width, height, rgba };
}

async function getRadarOpenEventsWithRegions(db, radarId) {
  const { results } = await db.prepare(`
    SELECT id, radar_id, zone_id, started_at, last_activity_at, closed_at,
           status, pixel_count, region_count, score, score_breakdown, created_at
    FROM radar_events
    WHERE radar_id = ? AND status != 'closed'
    ORDER BY last_activity_at DESC
  `).bind(radarId).all();

  return Promise.all((results || []).map(async event => {
    const regionRows = await db.prepare(`
      SELECT tile_x, tile_y, min_x, min_y, max_x, max_y, pixel_count, first_seen_at, last_seen_at
      FROM radar_event_regions
      WHERE event_id = ?
      ORDER BY id ASC
    `).bind(event.id).all();
    return { ...event, score_breakdown: event.score_breakdown ? JSON.parse(event.score_breakdown) : null, regions: regionRows.results || [] };
  }));
}

async function persistRadarEventDecision(env, decision) {
  if (decision.action === "none") return null;
  const event = decision.event;
  if (decision.action === "create") {
    const result = await env.DB.prepare(`
      INSERT INTO radar_events
        (radar_id, zone_id, started_at, last_activity_at, closed_at, status, pixel_count, region_count, score, score_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event.radar_id, event.zone_id, event.started_at, event.last_activity_at,
      event.closed_at, event.status, event.pixel_count, event.region_count,
      event.score, event.score_breakdown ? JSON.stringify(event.score_breakdown) : null
    ).run();
    const eventId = Number(result.meta?.last_row_id);
    if (!Number.isInteger(eventId)) throw new Error("ID d'événement Radar introuvable après création");
    const statements = decision.regions.map(region => env.DB.prepare(`
      INSERT INTO radar_event_regions
        (event_id, tile_x, tile_y, min_x, min_y, max_x, max_y, pixel_count, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(eventId, region.tile_x ?? region.tileX, region.tile_y ?? region.tileY,
      region.min_x ?? region.minX, region.min_y ?? region.minY,
      region.max_x ?? region.maxX, region.max_y ?? region.maxY,
      region.pixel_count ?? region.pixelCount ?? 0, event.started_at, event.last_activity_at));
    if (statements.length) await env.DB.batch(statements);
    return eventId;
  }

  if (decision.action === "update") {
    await env.DB.prepare(`
      UPDATE radar_events
      SET zone_id = ?, last_activity_at = ?, status = 'active', closed_at = NULL,
          pixel_count = ?, region_count = ?, score = ?, score_breakdown = ?
      WHERE id = ?
    `).bind(
      event.zone_id, event.last_activity_at, event.pixel_count, event.region_count,
      event.score, event.score_breakdown ? JSON.stringify(event.score_breakdown) : null,
      event.id
    ).run();
    const statements = decision.regions.map(region => env.DB.prepare(`
      INSERT INTO radar_event_regions
        (event_id, tile_x, tile_y, min_x, min_y, max_x, max_y, pixel_count, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(event.id, region.tile_x ?? region.tileX, region.tile_y ?? region.tileY,
      region.min_x ?? region.minX, region.min_y ?? region.minY,
      region.max_x ?? region.maxX, region.max_y ?? region.maxY,
      region.pixel_count ?? region.pixelCount ?? 0, event.last_activity_at, event.last_activity_at));
    if (statements.length) await env.DB.batch(statements);
    return event.id;
  }

  if (decision.action === "quiet" || decision.action === "close") {
    await env.DB.prepare(`
      UPDATE radar_events SET status = ?, closed_at = ? WHERE id = ?
    `).bind(event.status, event.closed_at ?? null, event.id).run();
    return event.id;
  }

  throw new Error(`Action événement Radar inconnue: ${decision.action}`);
}


// ================================================================
// RÉPONSE JSON COMMUNE
// ================================================================

function corsPreflight(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = getFrontendOrigin(env);
  if (origin !== allowedOrigin) return new Response(null, { status: 403 });

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Template-Filename",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin, Access-Control-Request-Headers"
    }
  });
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

async function updateRadarScanMetadata(db, radarId, fields) {
  if (!db || !radarId) return;
  const assignments = [];
  const values = [];
  if (fields.last_scan_at !== undefined) {
    assignments.push("last_scan_at = ?");
    values.push(fields.last_scan_at);
  }
  if (fields.last_success_at !== undefined) {
    assignments.push("last_success_at = ?");
    values.push(fields.last_success_at);
  }
  if (fields.last_error_at !== undefined) {
    assignments.push("last_error_at = ?");
    values.push(fields.last_error_at);
  }
  if (!assignments.length) return;
  try {
    await db.prepare(`UPDATE radars SET ${assignments.join(", ")} WHERE id = ?`)
      .bind(...values, radarId)
      .run();
  } catch (error) {
    // Operational metadata must never turn a successful Radar scan into a failure.
    console.error("Radar scan metadata update error:", error);
  }
}

function jsonAuth(request, data, status, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = getFrontendOrigin(env);

  const headers = {
    "Content-Type": "application/json; charset=UTF-8",
    "Vary": "Origin"
  };

  if (origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}
