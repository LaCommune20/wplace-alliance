# Radar proxy contract

The existing `/tile/X/Y.png` route is a map asset route and may use long-lived edge caching.

The Radar needs a separate route:

```text
GET /radar-tile/{tileX}/{tileY}.png
```

## Requirements

- validate `tileX` and `tileY` exactly like the existing tile route;
- fetch the same WPlace upstream tile;
- do not force a long Cloudflare cache TTL;
- return the upstream PNG body unchanged;
- preserve useful upstream validators such as `ETag` / `Last-Modified` when available;
- expose `Content-Type: image/png`;
- expose a small diagnostic header such as `X-WPlace-Proxy: WPlace-La-Commune-Radar`;
- keep the existing `/tile` behavior unchanged.

Cloudflare documents that Worker `fetch()` calls can explicitly force cache behavior with `cacheTtl` and `cacheEverything`; those settings therefore must not be copied from the map route into the Radar route. citeturn0search0turn0search7

## Why a separate route

Changing `/tile` would alter the performance characteristics of the live map. A dedicated route lets the Radar bypass long-lived map caching without regressing the user-facing map.

## Future optimization

If WPlace consistently supplies `ETag` or `Last-Modified`, the Radar can later use conditional requests to avoid downloading unchanged PNG bodies. This optimization must be verified against the real upstream response before being relied upon.
