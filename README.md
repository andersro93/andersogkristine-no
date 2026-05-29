# 💍 Kristine & Anders Wedding Website

An elegant, high-performance wedding website built with **Astro**, **React**, and **TailwindCSS**, designed to run as a server-side rendered (SSR) application on **Cloudflare Workers**.

Features:
- **Notion Integration:** Dynamically fetches schedule timeline events, seating plans, RSVPs, and neighborhood suggestions ("Egentid") from Notion databases with automatic Cloudflare KV caching.
- **PIN Gate:** Password protected using signed cookie sessions with brute-force rate-limiting.
- **Spotify Integration:** Fully interactive playlist suggestion page.
- **Interactive Map:** Interactive Leaflet map showcasing locations with popup details and recommendations.

---

## 🛠️ Local Development

### 1. Install Dependencies
```bash
bun install
```

### 2. Configure Environment
Create a `.env` file in the root directory (see `.env` for the required keys) with your Notion and Spotify credentials.

### 3. Run Development Server
```bash
bun run dev
```

### 4. Clear Local Caches
If you need to clear the local development caches (SQLite KV databases, compiler cache, etc.) and refresh all data from Notion:
```bash
bun run dev:clean
```

---

## 🚀 Deployment to Cloudflare Workers

Follow these steps to deploy your website to production on Cloudflare:

### 1. Create the KV Cache Namespace
The site uses a Cloudflare KV namespace called `CACHE` to cache database requests. Create it by running:
```bash
bun x wrangler kv namespace create CACHE
```
Copy the string `id` from the output and replace `"CACHE_PLACEHOLDER"` in your `wrangler.jsonc` configuration:
```json
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "YOUR_KV_NAMESPACE_ID_HERE"
    }
  ]
```

### 2. Configure Environment Secrets
Upload your Notion keys, database IDs, and site credentials to Cloudflare by running these commands:
```bash
# Notion Integration Keys
bun x wrangler secret put NOTION_API_KEY
bun x wrangler secret put NOTION_INVITES_DATABASE_ID
bun x wrangler secret put NOTION_GUESTS_DATABASE_ID
bun x wrangler secret put NOTION_TABLES_DATABASE_ID
bun x wrangler secret put NOTION_PROGRAM_DATABASE_ID
bun x wrangler secret put NOTION_LOCATIONS_DATABASE_ID
bun x wrangler secret put NOTION_EGENTID_DATABASE_ID
bun x wrangler secret put NOTION_MEDVIRKENDE_DATABASE_ID
bun x wrangler secret put NOTION_FAQ_DATABASE_ID
bun x wrangler secret put NOTION_FLAGS_DATABASE_ID

# Pin Protection Gate
bun x wrangler secret put SITE_PIN
bun x wrangler secret put SESSION_SECRET

# Spotify Integration (Optional)
bun x wrangler secret put SPOTIFY_CLIENT_ID
bun x wrangler secret put SPOTIFY_CLIENT_SECRET
bun x wrangler secret put SPOTIFY_REFRESH_TOKEN
```
*(Alternatively, you can manage these secrets inside the Cloudflare Dashboard under **Workers & Pages > [your-worker] > Settings > Variables & Secrets**).*

### 3. Build & Deploy
Compile the assets and deploy to Cloudflare using the combined deploy script:
```bash
bun run deploy
```

---

## 🚩 Feature Flags (Notion)

You can toggle different components and subpages of your wedding website dynamically from a dedicated Notion database.

### 1. Database Structure in Notion
Create a database in your Notion workspace with the following columns:
- **`Flagg Id`** (Title): The technical identifier of the feature (case-insensitive).
- **`Aktivert`** (Select or Status): The state of the toggle, set to either **`Ja`** or **`Nei`**.

### 2. Supported Feature Flags
Add rows for each of the following flags in your database to control the respective components:

| Flagg ID | Description | Behaviors when set to `Nei` |
| :--- | :--- | :--- |
| `rsvp` | Controls the RSVP registration. | Hides RSVP buttons on the homepage and blocks direct access to `/rsvp` (redirects to `/`). |
| `seating` | Controls the seating arrangement display. | Hides Bordplassering buttons on the homepage and blocks direct access to `/bordoppsett` (redirects to `/`). |
| `music` | Controls the Spotify suggestions tool. | Hides Musikk suggestions buttons on the homepage and blocks direct access to `/musikk` (redirects to `/`). |
| `map` | Controls the interactive Google/Leaflet map. | Hides Map sections, buttons, timeline map links, and blocks direct access to `/kart` (redirects to `/`). |
| `egentid` | Controls the Egentid recommendations. | Hides the entire polaroid/neighborhood recommendation section on the homepage. |
| `program` | Controls the wedding timeline. | Hides the timeline/program schedule section on the homepage. |

### 3. Caching & Fallbacks
- **Caching:** The flags are cached in Cloudflare KV for performance (60-second Stale-While-Revalidate refresh window). To force-clear the cache locally during development, run `bun run dev:clean`.
- **Default Fallbacks:** If the database cannot be queried, contains empty values, or is missing keys, the website defaults all flags to `true` (enabled) to ensure the site remains fully operational.

