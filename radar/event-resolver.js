// Pure Radar event lifecycle resolver.
// This module does not access D1 and does not classify the nature of a change.

const DEFAULT_PROXIMITY_PIXELS = 32;
const DEFAULT_QUIET_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_CLOSE_AFTER_MS = 15 * 60 * 1000;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function worldBounds(region) {
  const tileX = finiteNumber(region.tile_x ?? region.tileX);
  const tileY = finiteNumber(region.tile_y ?? region.tileY);
  const minX = finiteNumber(region.min_x ?? region.minX);
  const minY = finiteNumber(region.min_y ?? region.minY);
  const maxX = finiteNumber(region.max_x ?? region.maxX);
  const maxY = finiteNumber(region.max_y ?? region.maxY);

  return {
    minX: tileX * 1000 + minX,
    minY: tileY * 1000 + minY,
    maxX: tileX * 1000 + maxX,
    maxY: tileY * 1000 + maxY
  };
}

function axisGap(aMin, aMax, bMin, bMax) {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

export function regionsAreClose(a, b, proximityPixels = DEFAULT_PROXIMITY_PIXELS) {
  const left = worldBounds(a);
  const right = worldBounds(b);
  const dx = axisGap(left.minX, left.maxX, right.minX, right.maxX);
  const dy = axisGap(left.minY, left.maxY, right.minY, right.maxY);
  return Math.hypot(dx, dy) <= proximityPixels;
}

export function eventMatchesRegions(eventRegions = [], incomingRegions = [], options = {}) {
  const proximityPixels = options.proximityPixels ?? DEFAULT_PROXIMITY_PIXELS;
  if (!eventRegions.length || !incomingRegions.length) return false;

  return incomingRegions.some(incoming =>
    eventRegions.some(existing => regionsAreClose(existing, incoming, proximityPixels))
  );
}

function eventLastActivityMs(event) {
  const value = event.last_activity_at ?? event.lastActivityAt;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function eventStatus(event) {
  return event.status ?? "active";
}

export function findMatchingEvent(events = [], incomingRegions = [], now, options = {}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const reopenAfterMs = options.reopenAfterMs ?? DEFAULT_CLOSE_AFTER_MS;

  return events
    .filter(event => {
      const status = eventStatus(event);
      if (status === "closed") return false;
      const lastActivity = eventLastActivityMs(event);
      if (!Number.isFinite(lastActivity) || !Number.isFinite(nowMs)) return false;
      return nowMs - lastActivity <= reopenAfterMs;
    })
    .filter(event => eventMatchesRegions(event.regions ?? [], incomingRegions, options))
    .sort((a, b) => eventLastActivityMs(b) - eventLastActivityMs(a))[0] ?? null;
}

function isoTime(value) {
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

export function resolveRadarObservation({
  radarId,
  zoneId = null,
  observation,
  events = [],
  now = Date.now(),
  options = {}
}) {
  if (!observation || !observation.changed) {
    return { action: "none", event: null, regions: [] };
  }

  const seenAt = isoTime(now);
  const incomingRegions = observation.regions ?? [];
  const matchingEvent = findMatchingEvent(events, incomingRegions, now, options);

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
        pixel_count: finiteNumber(observation.summary?.changedMeaningfulPixels ?? observation.summary?.changedPixels),
        region_count: incomingRegions.length,
        score: finiteNumber(observation.score, 0),
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
      pixel_count: finiteNumber(matchingEvent.pixel_count) + finiteNumber(observation.summary?.changedMeaningfulPixels ?? observation.summary?.changedPixels),
      region_count: finiteNumber(matchingEvent.region_count) + incomingRegions.length,
      score: finiteNumber(observation.score, 0),
      score_breakdown: observation.summary ?? null
    },
    regions: incomingRegions,
    matchedEventId: matchingEvent.id ?? null
  };
}

export function resolveEventExpirations(events = [], now = Date.now(), options = {}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const quietAfterMs = options.quietAfterMs ?? DEFAULT_QUIET_AFTER_MS;
  const closeAfterMs = options.closeAfterMs ?? DEFAULT_CLOSE_AFTER_MS;

  return events
    .filter(event => eventStatus(event) !== "closed")
    .map(event => {
      const lastActivity = eventLastActivityMs(event);
      if (!Number.isFinite(lastActivity) || !Number.isFinite(nowMs)) {
        return { action: "none", event };
      }

      const age = nowMs - lastActivity;
      if (age >= closeAfterMs) {
        return {
          action: "close",
          event: {
            ...event,
            status: "closed",
            closed_at: isoTime(now)
          }
        };
      }

      if (age >= quietAfterMs && eventStatus(event) === "active") {
        return {
          action: "quiet",
          event: {
            ...event,
            status: "quiet"
          }
        };
      }

      return { action: "none", event };
    })
    .filter(result => result.action !== "none");
}

export const RADAR_EVENT_DEFAULTS = Object.freeze({
  proximityPixels: DEFAULT_PROXIMITY_PIXELS,
  quietAfterMs: DEFAULT_QUIET_AFTER_MS,
  closeAfterMs: DEFAULT_CLOSE_AFTER_MS,
  reopenAfterMs: DEFAULT_CLOSE_AFTER_MS
});
