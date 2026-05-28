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
The site uses a Cloudflare KV namespace called `WEDDING_CACHE` to cache database requests. Create it by running:
```bash
bun x wrangler kv namespace create WEDDING_CACHE
```
Copy the string `id` from the output and replace `"WEDDING_CACHE_PLACEHOLDER"` in your `wrangler.jsonc` configuration:
```json
  "kv_namespaces": [
    {
      "binding": "WEDDING_CACHE",
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
Compile the assets and deploy to Cloudflare:
```bash
# Build
bun run build

# Deploy
bun x wrangler deploy
```
