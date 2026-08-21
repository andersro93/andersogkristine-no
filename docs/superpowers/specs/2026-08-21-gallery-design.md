# Guest gallery (R2 + D1) — design spec

## Context

Guests should be able to take or pick photos/videos on their phones and upload them to the wedding site during the wedding day (2026-09-26) and afterwards, and browse everything other guests uploaded. Nothing like this exists in the repo today: the site is Astro 7 SSR + React islands on Cloudflare Workers with Notion as CMS and a KV cache — no R2, no D1, no uploads, no lightbox. Bytes go to **R2**, metadata to **D1**.

Decisions made in the brainstorm (2026-08-21):
- **Access:** the existing PIN session gates both upload and viewing (soft-gate model; no per-guest identity).
- **Moderation:** live immediately; the couple hide/unhide via an admin mode unlocked by a secret link → signed cookie.
- **Media:** photos **and** short videos. No transcoding.
- **Attribution:** one optional name field, remembered on the device. No captions.
- **Approach A:** the phone makes thumb/display derivatives; the Worker streams raw bodies into R2; one D1 row per item. No Cloudflare Images, no presigned URLs.
- **Plan:** Workers Paid → request volume is not a concern; 30 s polling is fine.


---

## 1. Architecture & data model

### Bindings & secrets
`wrangler.jsonc`:
```jsonc
"r2_buckets": [{ "binding": "GALLERY", "bucket_name": "andersogkristine-gallery" }],
"d1_databases": [{ "binding": "DB", "database_name": "andersogkristine-gallery", "database_id": "<from wrangler d1 create>", "migrations_dir": "migrations" }]
```
`src/env.d.ts` `interface Env` gains `GALLERY?: R2Bucket; DB?: D1Database; GALLERY_ADMIN_KEY?: string;` (optional like `CACHE?`; missing → fail soft with a Norwegian 503, same idea as `SPOTIFY_UNAVAILABLE` in `src/utils/http.ts`).

### R2 key layout (one prefix per item)
```
media/<uuid>/thumb.<webp|jpg>      ≤ 480 px long edge  (image thumb / video poster)
media/<uuid>/display.<webp|jpg>    ≤ 2048 px long edge (images only)
media/<uuid>/original.<ext>        untouched phone file: jpg|png|webp|heic|mp4|mov
```
`httpMetadata.contentType` set from the validated MIME on every object.

### D1 — `migrations/0001_gallery.sql`
```sql
CREATE TABLE media (
  id TEXT PRIMARY KEY,                  -- crypto.randomUUID()
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready')),
  created_at INTEGER NOT NULL,          -- server unix ms at POST
  ready_at INTEGER,                     -- server unix ms at complete; feed order + cursor + since
  uploader_name TEXT,                   -- trimmed, ≤ 60 chars, control chars stripped
  device_id TEXT NOT NULL,              -- random uuid from localStorage; owner of the row; quota key
  ip_hash TEXT,                         -- sha256(ip + SESSION_SECRET), abuse backstop only
  width INTEGER, height INTEGER, duration_ms INTEGER,
  original_key TEXT, original_mime TEXT, original_bytes INTEGER,
  display_key TEXT, thumb_key TEXT,
  hidden_at INTEGER, hidden_by TEXT     -- soft hide: 'admin' | 'owner'
);
CREATE INDEX media_feed   ON media (status, hidden_at, ready_at DESC, id);
CREATE INDEX media_device ON media (device_id, created_at);
CREATE INDEX media_ip     ON media (ip_hash, created_at);
```
Visible ⇔ `status='ready' AND hidden_at IS NULL`. Feed, keyset cursor (`${ready_at}_${id}`) and `since` all use `ready_at`, not `created_at` — otherwise an item created before a poll but completed after it would never be fetched. Rows stuck in `uploading` are never shown; admin view shows their count; purge is a documented one-liner.

**D1 rules for `db.ts`:** only `?` placeholders, every bind normalised with `?? null` (D1 throws `D1_TYPE_ERROR` on `undefined`; bun:sqlite silently binds NULL — the fake must throw on `undefined` to mirror D1), booleans as 0/1, epoch ms integers everywhere.

### Code layout — `src/services/gallery/`
| file | role |
|---|---|
| `index.ts` | barrel |
| `validation.ts` | pure: kind/MIME/ext allowlists, per-variant size caps, name sanitising, UUID/variant/cursor codecs, magic-byte sniff table (JPEG, PNG, RIFF/WEBP, HEIC `ftyp` brands, MP4/MOV `ftyp`), `Content-Range` math; `validateCreatePayload()` → `{ok, value} \| {ok:false, error}` (shape of `validateRsvpPayload`, `src/services/rsvp.ts`) |
| `keys.ts` | pure: `variantKey(id, variant, mime)`, `extForMime()` |
| `db.ts` | D1 repository: `createItem`, `setVariant`, `markReady`, `listFeed({cursor, limit, since, deviceId?, includeHidden})`, `getItem`, `setHidden`, `clearHidden`, `countRecent({deviceId \| ipHash, sinceMs})`, `countStuck`; row → `GalleryItem` mapper |
| `admin.ts` | `generateAdminCookie` / `verifyAdminCookie` on top of a generalised `signValue(purpose, exp, env)` / `verifyValue(...)` exported from `src/services/pin.ts` (today the HMAC helpers hardcode `session:`), `isGalleryAdmin(cookies, env)`, `tryAdminBootstrap(context)` |
| `quota.ts` | **per-device** quota in D1 (`countRecent(deviceId, 1 h) < 100`) + a high **per-IP-hash** backstop (2000/h). Not KV and not per-IP primary: the whole venue shares one NAT IP, and KV counters are eventually consistent (~1 write/s/key). |

Caveat (accepted): Workers Builds PR previews share prod bindings — preview uploads land in the real bucket/DB; hide them via admin.

---

## 2. API surface & upload protocol

Routes under `/api/galleri/*` and `/galleri` are PIN-gated automatically by `src/middleware.ts`. Handlers: `APIRoute` + `json()` from `src/utils/http.ts` + Norwegian errors; `import { env } from "../../../runtime"`. Route files: `media/index.ts` (POST, GET), `media/[id]/index.ts` (DELETE), `media/[id]/[variant].ts` (PUT), `media/[id]/complete.ts`, `media/[id]/unhide.ts`, `file/[id]/[variant].ts` (static segments win over `[variant]`). Every handler validates `id` as UUID and `variant` as the enum.

### Upload (per file): 1 JSON POST + 2–3 raw PUTs + 1 complete
| # | Route | Behaviour |
|---|---|---|
| 1 | `POST /api/galleri/media` JSON `{kind, mime, bytes, name?, width?, height?, durationMs?}` + header `X-Device-Id` | `gallery_upload` flag on (else 403 "Opplasting er stengt."); validate; device + IP quota (429); insert row `uploading` → `201 {id}` |
| 2 | `PUT /api/galleri/media/:id/thumb` raw body, `Content-Type`, `Content-Length` | device must match row (403); row `uploading` (409); `Content-Length` required (411) and ≤ cap (413: thumb 1 MB, display 4 MB, original image 30 MB / video 80 MB); `GALLERY.put(key, request.body.pipeThrough(new FixedLengthStream(len)), {httpMetadata:{contentType}})` — R2 needs a known-length stream, and FixedLengthStream also enforces the declared size (guard `typeof FixedLengthStream === "undefined"` → identity in bun tests); verify `obj.size === len`; `GALLERY.get(key, {range:{offset:0,length:16}})` → sniff magic bytes vs declared MIME → mismatch = delete + 415; update `<variant>_key` (+ `original_bytes`) → `200 {ok:true}` |
| 3 | `PUT …/display` (images only) | same |
| 4 | `PUT …/original` | same |
| 5 | `POST …/complete` | image: needs `thumb_key` + `display_key`; video: needs `original_key` (poster optional) → `status='ready', ready_at=now` → `200 {item}`; else 409 naming the missing part |

Client order thumb → display → original, so an item is viewable seconds after tapping. If the original PUT fails after retries the client still completes images ("last ned original" then serves display). Videos fail closed. Always send a real MIME (or `application/octet-stream`) on PUT — Astro's origin check only bites `text/plain`/form content types.

### Read
- `GET /api/galleri/media?cursor=<ready_at>_<id>&limit=40&since=<ms>&mine=1&all=1` → `{items: GalleryItem[], nextCursor}`; newest first, keyset on `(ready_at DESC, id DESC)`; `since` → `ready_at > since` (powers the "N nye bilder" pill); `mine` filters by `X-Device-Id`; `all=1` (admin only) includes hidden + `{stuckCount}`. Item: `{id, kind, name, createdAt, width, height, durationMs, hasOriginal, thumbUrl?, displayUrl?, originalUrl?, mine, hiddenAt?}` — device ids never leave the server.
- `GET /api/galleri/file/:id/:variant` → D1 `getItem` (visible, or admin cookie; else JSON 404) → `GALLERY.get(key, {range: request.headers, onlyIf: request.headers})`; result may be a body-less `R2Object` (→ 304) or throw on unsatisfiable range (→ 416); for `R2ObjectBody`: `obj.writeHttpMetadata(headers)`, `ETag: obj.httpEtag`, `Accept-Ranges: bytes`, `Cache-Control: private, max-age=31536000, immutable`; when `obj.range` is set normalise its three shapes to `start/end`, respond 206 with `Content-Range: bytes start-end/size` and `Content-Length` = part length. Range passthrough is required for `<video>` seeking (Safari probes `bytes=0-1` first).

### Delete / admin
- `DELETE /api/galleri/media/:id` → owner (device match) or admin → `setHidden(id, 'owner'|'admin')` (soft; R2 objects stay).
- `POST /api/galleri/media/:id/unhide` → admin only.
- Admin unlock: `galleri.astro` frontmatter calls `tryAdminBootstrap(context)`: `?admin=<key>` → `secureCompare(key, env.GALLERY_ADMIN_KEY)` → set `gallery_admin` cookie (signed `gallery_admin:<exp>`, httpOnly, secure, lax, 30 d) → redirect to clean `/galleri`. Wrong key → `recordFailedAttempt(ip, kv, "gallery_admin")` (new `RateLimitScope` member) + silent redirect; `?admin=logout` clears.

### Flags & middleware (`src/middleware.ts`)
- `gallery`: `Nei` → `/galleri` → redirect `/`; `/api/galleri/*` → `json({error:"Ikke funnet."}, 404)` (a **null-body** 404 from middleware gets rerouted to Astro's error page — body must be non-null). Hero/Footer links hidden.
- `gallery_upload`: `Nei` → upload UI hidden, `POST media` → 403.
- Unauthenticated `/api/*` requests (non-bypass) now get `json({error:"Logg inn på nytt."}, 401)` instead of a 302 to `/pin` — XHR/fetch can't act on an HTML redirect; client reloads the page on 401. (Small general improvement; existing API consumers only ever hit this when the session has expired.)
- Both flags added to `DEFAULT_FLAGS` (`src/services/notion/flags.ts`) and the README flag table.
- `Permissions-Policy: camera=()` stays — `<input type=file capture>` hands off to the OS camera app; it's `getUserMedia` that the header governs.

---

## 3. Client UX

**Page** `src/pages/galleri.astro` — `SubpageLayout` (`heading="Galleri"`, subtitle "Del bildene og videoene dine fra dagen", `width="max-w-6xl"`, `card={false}`), `tryAdminBootstrap` in frontmatter, renders `<Gallery client:load isAdmin uploadOpen />`. Hero (`src/components/Hero.astro:84-89`) + Footer (`:25-29`) get a `flags.gallery` "Galleri" link next to Musikk.

**Island** `src/components/gallery/`:
- `Gallery.tsx` — root; composes the pieces + `useToast`.
- `UploadBar.tsx` — "Ta bilde eller video" (`accept="image/*,video/*" capture="environment"`) and "Velg fra kamerarullen" (`multiple`); "Ditt navn (valgfritt)" persisted in `localStorage.galleri_navn`; `localStorage.galleri_device` uuid created on first visit; queue list with per-file progress bar + "Prøv igjen"; files over the cap rejected client-side with a clear message before any upload.
- `useUploadQueue.ts` — 2 concurrent; per-file state `preparing → thumb → display → original → done | error`; XHR PUTs for byte progress; each PUT retried 3× (backoff); original failure on images still → complete; 401 → reload; `beforeunload` guard while active. Pure helpers (`planUploadSteps(kind, hasPoster)`, backoff schedule) live in `uploadPlan.ts` and are unit-tested.
- `derivatives.ts` — `makeImageDerivatives(file)`: `createImageBitmap(file, {resizeWidth/Height, resizeQuality:"high", imageOrientation:"from-image"})` (resize during decode — 48 MP photos) → canvas → `toBlob("image/webp", 0.82)`, check `blob.type` and fall back to JPEG 0.85 (Safari returns PNG/non-WebP); if `createImageBitmap` rejects, fall back to `<img>` + `decode()` + `drawImage`; still undecodable (HEIC on Android Chrome) → inline "Kunne ikke behandle bildet", not uploaded. `makeVideoPoster(file)`: muted `playsInline preload="metadata"` `<video>` on a blob URL, seek ~0.1 s, draw after `seeked` → `{poster?, width, height, durationMs}`; poster failure tolerated.
- `Feed.tsx` + `useFeed.ts` — `grid-cols-3 md:grid-cols-5 gap-1`, square `object-cover` lazy thumbs, play glyph + duration on videos, generic tile when no poster, IntersectionObserver sentinel for infinite scroll, 30 s `since` poll only while `document.visibilityState === "visible"` → "N nye bilder" pill that prepends on tap, "Alle / Mine" toggle, optimistic prepend of own completed uploads.
- `Lightbox.tsx` — `<dialog>`-based full-screen overlay; `<img src=displayUrl>` or `<video controls playsInline poster src=originalUrl>` with `onError` → "Kan ikke spilles av i denne nettleseren – last ned" (iPhone HEVC `.mov` only plays in Safari; no transcoding); prev/next buttons, pointer-swipe, arrow keys, Esc/backdrop close, body scroll lock, neighbour preload; caption = name + time; actions: **Last ned** (`<a download>` original ?? display), **Slett** (own; confirm), admin **Skjul / Vis**.
- Admin mode: hidden items dimmed with "Skjult" badge; admin bar "X skjult · Y ufullstendige".
- Biome a11y rules apply to `.tsx`: `<track kind="captions">` (or targeted `biome-ignore`) on `<video>`, `type` on buttons, `<button>`/`<dialog>` instead of clickable divs, alt text, no array-index keys, exhaustive hook deps, icons from the `ICONS` registry.

### Delight (motion layer — all of it respects `prefers-reduced-motion`)
- **Optimistic tile:** the moment files are picked, one tile per file is inserted at the *top* of the grid showing a local preview (object URL of the generated thumb / video poster) dimmed, with a thin progress ring and stage text ("Klargjør…", "Laster opp… 63 %"). The queue item and the feed item share an id so the tile later becomes the real item in place.
- **FLIP slide:** `useFlipGrid.ts` — measure tile `getBoundingClientRect` before and after a feed change, apply the inverse `transform`, transition to identity (~40 lines, no library, works on every phone). Existing tiles glide to make room for new ones.
- **Pop on complete:** server thumb is preloaded (`new Image()`), then the tile scales 0.96→1 with a brief check-mark flash and swaps to the real URL — no flicker. On error: short shake + "Prøv igjen".
- **New from others:** tapping "N nye bilder" slides the arrivals in from the top with a light stagger/fade via the same FLIP path. The pill/header carries a subtle **pulsing live dot** while arrivals are waiting.
- **Lightbox:** opens with fade + scale from the tapped tile's rect (`transform-origin`), closes the same way.
- **First-upload celebration:** on the first successful `complete` per session, toast "Takk for bildet! 🎉" + a brief dependency-free canvas confetti burst (`confetti.ts`, ~60 lines, skipped under reduced motion).
- Keyframes (`fade-in`, `pop`, `shake`, `pulse`) go in `src/styles/global.css` (`@keyframes` + small utilities), reused by the existing `animate-fade-in` usage.

**Shared:** add `camera`, `image`, `video`, `download`, `trash`, `chevronLeft`, `eye`, `eyeOff` to `src/components/ui/icons.ts`; move `src/components/spotify/useToast.tsx` → `src/components/ui/useToast.tsx` (update Spotify imports). Styling via existing `btn-primary` / `btn-secondary` / `input-base` / `alert-error`. No new npm dependencies.

---

## 4. Error handling, ops, cost, testing

**Errors:** bindings/secret missing → 503 "Galleriet er ikke tilgjengelig akkurat nå." and the page renders `alert-error` instead of the island; D1/R2 failures → `console.error` + generic 500/502 (client retries); sniff mismatch → 415 + object deleted; lightbox `<img onerror>` falls back display → original. Workers request body limit (100 MB on Free/Pro zones) returns 413 before our code — the 80 MB video cap stays.

**Local dev:** `astro dev` runs through `@cloudflare/vite-plugin` (workerd + miniflare); R2/D1 come straight from `wrangler.jsonc` into `.wrangler/state/v3` — the same dir wrangler's D1 CLI uses, keyed by `database_id`. New scripts: `db:migrate:local` = `wrangler d1 migrations apply andersogkristine-gallery --local` (chained into `dev`), `db:migrate:remote` = `… --remote` (manual; Workers Builds does not run migrations — apply before merging a schema change). `dev:clean` wipes the local DB; re-run migrations (the `dev` chain does).

**One-time setup (README):** `wrangler r2 bucket create andersogkristine-gallery`; `wrangler d1 create andersogkristine-gallery` → paste `database_id`; `bun run db:migrate:remote`; `wrangler secret put GALLERY_ADMIN_KEY`; add Notion flag rows `gallery`, `gallery_upload`. **Export afterwards:** `rclone sync` of the bucket (R2 S3 credentials) + `wrangler d1 export` — documented, not built.

**Cost:** ~1000 photos + 50 videos ≈ 7.5 GB → within R2 free 10 GB; egress free; D1 trivial; Workers Paid covers requests.

**Testing:**
- Fakes: `src/tests/fakes/d1.ts` — bun:sqlite-backed `D1Database` (`prepare(sql).bind(...).first()/all()/run()` with D1 result shapes `{results, success, meta}`, `batch()`, `exec()`; throws on `undefined` binds) and `src/tests/fakes/fakes.test.ts` applying the real `migrations/0001_gallery.sql`; `src/tests/fakes/r2.ts` — in-memory bucket (`put` draining stream/ArrayBuffer/Uint8Array/string, `get` parsing `Range` `bytes=a-b | a- | -n` and returning `range/size/httpEtag/writeHttpMetadata`, `head`, `delete`, `list`).
- Unit (colocated): `validation.test.ts`, `keys.test.ts`, `admin.test.ts` (HMAC tamper/expiry), `quota.test.ts`, `db.test.ts` (keyset pagination, `since`, hidden filter, null normalisation), `uploadPlan.test.ts`, `pin.test.ts` additions for `signValue/verifyValue`.
- API: `src/tests/api/gallery.test.ts` using the `mock.module("cloudflare:workers", …)` + dynamic-import recipe from `src/tests/api/rsvp.test.ts`, with explicit `Content-Length` headers on test requests (`new Request(url, {body})` doesn't add one): create (validation, quotas 429, upload flag 403, missing bindings 503), PUT (device mismatch 403, 411, 413, sniff 415, wrong status 409, size mismatch), complete rules, feed (cursor, `since`, hidden filter, `mine`, `all` admin-only), file (200, 206 Range incl. `bytes=0-1`, 304, 416, hidden → 404 unless admin), delete owner/admin, unhide admin-only.
- `src/middleware.test.ts`: `/galleri` redirect + `/api/galleri` JSON 404 when `gallery` off; unauthenticated `/api/*` → 401 JSON.
- Manual phone checklist on the PR preview URL (iPhone Safari + Android Chrome): capture, multi-select, HEIC photo, HEVC `.mov` (plays on iPhone, shows download hint on Android), > 80 MB video rejected before upload, poster, swipe, video seek, delete own, admin hide/unhide, flags off.

---

## Implementation order (to be expanded by writing-plans)

0. Save this spec to `docs/superpowers/specs/2026-08-21-gallery-design.md`, commit.
1. Infra: `wrangler.jsonc` bindings, `migrations/0001_gallery.sql`, `env.d.ts`, `package.json` scripts, README setup section.
2. Test fakes: `src/tests/fakes/d1.ts`, `r2.ts`, `fakes.test.ts`.
3. `services/gallery/validation.ts` + `keys.ts` (TDD).
4. `services/gallery/db.ts` (TDD against fake D1 + real migration).
5. `pin.ts` generalisation (`signValue/verifyValue`, `"gallery_admin"` scope) + `services/gallery/admin.ts` + `quota.ts` (TDD).
6. Flags + middleware (`gallery`, `gallery_upload`, API 401 JSON) + tests + README table.
7. API: create / put / complete (TDD).
8. API: feed / file (Range) / delete / unhide (TDD).
9. Icons + move `useToast` to `ui/`; `galleri.astro` + Hero/Footer links.
10. Client: `uploadPlan.ts` (TDD), `derivatives.ts`, `useUploadQueue.ts`, `UploadBar.tsx`.
11. Client: `useFeed.ts`, `Feed.tsx`, `Lightbox.tsx`, `Gallery.tsx`.
12. Delight: `useFlipGrid.ts`, optimistic tiles + pop/shake, new-arrivals slide-in + live dot, lightbox transitions, `confetti.ts` + thank-you toast, keyframes in `global.css`.
13. `bun run ci`; manual phone checklist on PR preview (incl. animations on a mid-range Android, reduced-motion setting); `db:migrate:remote`, secret, Notion flags.

## Verification
- `bun run ci` (biome, tsc, bun test, astro build) green.
- `bun run dev` → `/galleri`: upload a photo and a video (desktop picker or phone on LAN); thumb appears within seconds; lightbox plays video with seeking; delete own; `?admin=<key>` unlocks hide/unhide; flags off → redirect / JSON 404; expired session → 401 → reload to `/pin`.
- PR preview URL: phone checklist above on iPhone + Android.
