/*
 * WPlace La Commune — Worker addition
 *
 * Insert this block in the Worker immediately after the existing
 * GET /api/admin/zones route and before adminZoneIdMatch.
 *
 * This endpoint is intentionally Admin-only because it creates geometry.
 */

if (url.pathname === "/api/admin/zones" && request.method === "POST") {
  const session = await requireAdminOrModerator(request, env);

  if (!session || session.access !== "admin") {
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

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
      return jsonAuth(request, { error: "Slug invalide" }, 400, env);
    }

    if (description.length > 1000) {
      return jsonAuth(request, { error: "Description trop longue" }, 400, env);
    }

    if (!continent || continent.length > 80 || !country || country.length > 80) {
      return jsonAuth(request, { error: "Continent ou pays invalide" }, 400, env);
    }

    if (ownerName && ownerName.length > 120) {
      return jsonAuth(request, { error: "Responsable invalide" }, 400, env);
    }

    if (!["active", "archived"].includes(status)) {
      return jsonAuth(request, { error: "Statut invalide" }, 400, env);
    }

    if (!Number.isFinite(focusZoom) || focusZoom < 0 || focusZoom > 24) {
      return jsonAuth(request, { error: "Zoom invalide" }, 400, env);
    }

    const categorySlug = String(body?.category_slug || "").trim();
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

    let polygon = body?.polygon;
    if (typeof polygon === "string") {
      try {
        polygon = JSON.parse(polygon);
      } catch {
        return jsonAuth(request, { error: "Polygone JSON invalide" }, 400, env);
      }
    }

    if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 500) {
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
        return jsonAuth(request, { error: "Sommet de polygone invalide" }, 400, env);
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
        return jsonAuth(request, { error: "Coordonnée géographique invalide" }, 400, env);
      }

      normalizedPolygon.push([lat, lng]);
    }

    const polygonKeys = normalizedPolygon.map(point => point.join(","));
    if (new Set(polygonKeys).size !== polygonKeys.length) {
      return jsonAuth(
        request,
        { error: "Le polygone contient des sommets dupliqués" },
        400,
        env
      );
    }

    let center = body?.center;
    if (typeof center === "string") {
      try {
        center = JSON.parse(center);
      } catch {
        return jsonAuth(request, { error: "Centre JSON invalide" }, 400, env);
      }
    }

    const centerLng = Number(
      Array.isArray(center) ? center[0] : center?.longitude ?? center?.lng
    );
    const centerLat = Number(
      Array.isArray(center) ? center[1] : center?.latitude ?? center?.lat
    );

    if (
      !Number.isFinite(centerLng) ||
      !Number.isFinite(centerLat) ||
      centerLng < -180 ||
      centerLng > 180 ||
      centerLat < -90 ||
      centerLat > 90
    ) {
      return jsonAuth(request, { error: "Centre invalide" }, 400, env);
    }

    const slugConflict = await env.DB.prepare(`
      SELECT id
      FROM zones
      WHERE slug = ?
      LIMIT 1
    `).bind(slug).first();

    if (slugConflict) {
      return jsonAuth(request, { error: "Ce slug est déjà utilisé" }, 409, env);
    }

    const now = Math.floor(Date.now() / 1000);
    const polygonText = JSON.stringify(normalizedPolygon);
    const centerText = JSON.stringify({
      longitude: centerLng,
      latitude: centerLat
    });

    /*
     * D1 batch keeps the zone insertion and its initial history entry atomic.
     * last_insert_rowid() refers to the zone inserted immediately before it.
     */
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
        VALUES (
          last_insert_rowid(),
          1,
          'create',
          ?,
          ?,
          ?
        )
      `).bind(
        JSON.stringify({
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
          center: { longitude: centerLng, latitude: centerLat },
          focus_zoom: focusZoom
        }),
        session.user.id,
        now
      )
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
      INNER JOIN categories c ON c.id = z.category_id
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

    return jsonAuth(request, { ok: true, zone: created }, 201, env);
  } catch (error) {
    console.error("Erreur D1 /api/admin/zones POST:", error);

    await writeAdminLog(
      env,
      session.user.id,
      "zone_create",
      "zone",
      null,
      "error",
      "Échec de création de zone",
      { message: String(error?.message || error) }
    );

    return jsonAuth(
      request,
      { error: "Impossible de créer la zone" },
      500,
      env
    );
  }
}
