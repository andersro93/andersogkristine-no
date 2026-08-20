# 💍 Kristine & Anders — bryllupsside

Wedding website built with **Astro** (SSR) + **React** islands + **Tailwind CSS**, running on **Cloudflare Workers**. **Notion** is the CMS and guest database, **Cloudflare KV** is the cache, **Spotify** powers the playlist page.

Features:
- **Notion integration** — program, seating, RSVP, FAQ, "Egentid" recommendations, locations, "Vår historie" and feature flags are read from Notion databases with a stale-while-revalidate KV cache.
- **Access gate** — a printed PIN (or a personal invite code in `?code=`) grants a signed, httpOnly session cookie. Failed PIN / code attempts are rate-limited per IP.
- **RSVP** — guests answer per person; allergies are written to a Notion multi-select.
- **Spotify** — guests search and add songs to the wedding playlist.
- **Map** — Leaflet map (bundled) with locations, program and recommendations.

---

## 🛠️ Local development

Runtime versions are pinned in **`mise.toml`** (Bun, Node) and managed with [mise](https://mise.jdx.dev) — the same file drives CI, so local, CI and production build with identical runtimes.

```bash
mise trust && mise install   # first time: installs the pinned bun + node
bun install
cp .env.example .env         # fill in the values below
bun run dev                  # runs the Notion prebuild sync, then `astro dev`
```

If you use mise's shell activation, the pinned versions are on `PATH` automatically inside this directory; otherwise prefix commands with `mise exec --` (e.g. `mise exec -- bun run dev`). To bump a runtime, change `mise.toml`, run `mise install`, and update the `BUN_VERSION` / `NODE_VERSION` build variables in Cloudflare (see Deployment).

Useful scripts:

| Script | What it does |
|---|---|
| `bun run dev` | Prebuild sync from Notion + dev server |
| `bun run build` | Prebuild sync + production build to `dist/` |
| `bun run ci` | Everything CI runs: `biome ci`, `tsc --noEmit`, `bun test`, `astro build` |
| `bun run lint` / `bun run format` | Biome lint / format |
| `bun run check` | Type-check only |
| `bun test` | Unit tests (services, middleware, API handlers) |
| `bun run dev:clean` | Clear local Wrangler KV state and the Astro cache |
| `bun run src/scripts/spotify-auth.ts` | One-off: obtain a Spotify refresh token |
| `bun run src/scripts/update_locations.ts` | One-off: bulk-update location coordinates in Notion |

### Environment variables

Secrets in production live in Cloudflare (Workers → Settings → Variables & Secrets, or `bun x wrangler secret put NAME`). Locally they come from `.env`. The prebuild step also needs the Notion variables as **build** variables in Cloudflare Workers Builds (see Deployment).

| Variable | Required | Used for |
|---|---|---|
| `NOTION_API_KEY` | ✅ | All Notion access (runtime + prebuild) |
| `NOTION_INVITES_DATABASE_ID` | ✅ | Invite code lookup |
| `NOTION_GUESTS_DATABASE_ID` | ✅ | Guests, RSVP, seating |
| `NOTION_TABLES_DATABASE_ID` | ✅ | Seating |
| `NOTION_PROGRAM_DATABASE_ID` | ✅ | Program timeline |
| `NOTION_LOCATIONS_DATABASE_ID` | ✅ | Map |
| `NOTION_EGENTID_DATABASE_ID` | ✅ | Recommendations |
| `NOTION_MEDVIRKENDE_DATABASE_ID` | ✅ | Contributors / toastmasters |
| `NOTION_FAQ_DATABASE_ID` | ✅ | FAQ |
| `NOTION_FLAGS_DATABASE_ID` | ✅ | Feature flags |
| `NOTION_STORY_DATABASE_ID` | ✅ | "Vår historie" |
| `SITE_PIN` | ✅ | Printed access PIN. **The app fails closed in production if unset.** |
| `SESSION_SECRET` | ✅ | HMAC key for the session cookie (random ≥32 hex chars). **Fails closed if unset.** |
| `SPOTIFY_CLIENT_ID` | optional | Spotify; if any Spotify variable is missing the music page shows "ikke tilgjengelig" in production (mock data only in dev/test) |
| `SPOTIFY_CLIENT_SECRET` | optional | — " — |
| `SPOTIFY_REFRESH_TOKEN` | optional | — " — (generate with `src/scripts/spotify-auth.ts`) |
| `SPOTIFY_PLAYLIST_ID` | optional | — " — |

Bindings (in `wrangler.jsonc`): `CACHE` (KV namespace) and `ASSETS`.

### Notion schema expectations

Every Notion column the site reads is mapped in **`src/config/notion.ts`** (`notionConfig.mappings`, one entry per database, with the column type noted). If you rename a column in Notion, change it there. The important ones:

- **Invites**: `Kode` (rich_text, the invite code), `🧑‍🤝‍🧑 Gjester` (relation → Guests), `Name` (title).
- **Guests**: `Navn` (title), `RSVP` (status: `Venter` / `Kommer` / `Kommer ikke`), `Allergener` (**multi_select** — new options are created automatically from what guests type; review before sending to the kitchen), `Bord` (relation → Tables).
- **Tables**: `Name` (title).
- **Program**: `Tittel`, `Tidspunkt` (date), `Beskrivelse`, `Webside` (select `Ja` to publish), `Sted` (relation → Locations). The page emoji is used as the icon.
- **Flags**: see below.

---

## 🚀 Deployment

Deployments run through **Cloudflare Workers Builds**, connected to this GitHub repository — there is no deploy step in GitHub Actions and nothing needs to be deployed from a laptop.

- Merges to `main` build and deploy production.
- Pull requests get a **preview URL** from Workers Builds (enable "Preview deployments" for non-production branches in the Worker's Builds settings if it is not already on) — use it to verify changes before merging.
- **Runtime versions:** Workers Builds does not read `mise.toml`. Set the build variables `BUN_VERSION` and `NODE_VERSION` in the Worker's Builds settings to the same values as `mise.toml` (currently Bun `1.4.0`, Node `24`); otherwise the build image's defaults are used and may differ from what CI tested.
- The build command is `bun run build`. Because the prebuild step snapshots Notion into `src/config/notion-fallback.json` (the offline fallback the site serves if Notion is down and nothing is cached), the **Notion variables must be available as build variables** in Workers Builds, not only as runtime secrets. Without them the build still succeeds but the fallbacks are empty.
- `bun run deploy` (build + `wrangler deploy`) still works as a manual escape hatch.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: installs the runtimes from `mise.toml` via `jdx/mise-action`, then Biome (lint + format), `tsc --noEmit`, the unit tests and a hermetic `astro build` (no Notion key, so the prebuild sync is skipped). Mark the **"Lint, typecheck, test, build"** check as required on `main`.

### KV cache

One KV namespace, `CACHE`. Notion data is cached with stale-while-revalidate semantics (`src/services/cache.ts`): entries are refreshed in the background after 60 s and served indefinitely if Notion is unreachable — by design, so a Notion outage does not take the site down. Seating is invalidated on every RSVP. Rate-limit counters (`pin_limit:*`, `invite_limit:*`) expire after one hour. To force a refresh, delete the `notion_*` keys in the Cloudflare dashboard.

---

## 🩺 Monitoring

- **Health endpoint**: `GET /api/health` (unauthenticated) returns `{ ok, kv, notion, ts }` with HTTP 200 or 503. It only reports booleans.
- **Uptime**: point an external monitor (Cloudflare Health Checks, UptimeRobot, Better Stack, …) at `https://andersogkristine.no/api/health` every 5 minutes with alerting to your phone. `/pin` is a good secondary check for "does the site render at all".
- **Logs & traces**: enabled in `wrangler.jsonc` (Workers → Observability).

---

## 🔐 Security model (short version)

- The PIN is printed on the invitations and is deliberately a "keep random visitors out" gate, not a secret. The session cookie is HMAC-signed (`SESSION_SECRET`), httpOnly, secure, `SameSite=Lax`, 30 days.
- Personal invite codes (`/rsvp?code=…` or `?code=…` on any page) also grant a session. Failed PIN and code attempts are rate-limited per IP (10 attempts → 5-minute lockout).
- `POST /api/rsvp` requires the invite code and only accepts guest ids that belong to that invite; RSVP values are allow-listed.
- Baseline security headers are set in the middleware (HSTS, nosniff, Referrer-Policy, `frame-ancestors 'none'`). The site is `noindex`.

---

## 🚩 Feature flags (Notion)

Toggle components and subpages from a Notion database.

### Database structure
- **`Flagg Id`** (title): the flag identifier (case-insensitive).
- **`Aktivert`** (select or status): `Ja` / `Nei`.

### Supported flags

| Flagg ID | Controls | When `Nei` |
| :--- | :--- | :--- |
| `rsvp` | RSVP | Hides RSVP buttons; `/rsvp` redirects to `/`. |
| `seating` | Seating chart | Hides buttons; `/bordoppsett` redirects to `/`. |
| `music` | Spotify page | Hides buttons; `/musikk` redirects to `/`. |
| `map` | Map | Hides map sections/links; `/kart` redirects to `/`. |
| `egentid` | Recommendations | Hides the section on the homepage. |
| `program` | Timeline | Hides the section on the homepage. |

Flags are resolved once per request in the middleware (`Astro.locals.flags`), cached in KV like everything else, and default to **enabled** if the database cannot be read.
