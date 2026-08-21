/// <reference types="astro/client" />

interface Env {
  NOTION_API_KEY: string;
  NOTION_INVITES_DATABASE_ID: string;
  NOTION_GUESTS_DATABASE_ID: string;
  NOTION_TABLES_DATABASE_ID: string;
  NOTION_PROGRAM_DATABASE_ID?: string;
  NOTION_LOCATIONS_DATABASE_ID?: string;
  NOTION_EGENTID_DATABASE_ID?: string;
  NOTION_MEDVIRKENDE_DATABASE_ID?: string;
  NOTION_FAQ_DATABASE_ID?: string;
  NOTION_FLAGS_DATABASE_ID?: string;
  NOTION_STORY_DATABASE_ID?: string;
  SITE_PIN?: string;
  SESSION_SECRET?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_REFRESH_TOKEN?: string;
  SPOTIFY_PLAYLIST_ID?: string;
  CACHE?: KVNamespace;
  /** Gallery bytes (R2). Optional so the site degrades to "ikke tilgjengelig" without it. */
  GALLERY?: R2Bucket;
  /** Gallery metadata (D1). */
  DB?: D1Database;
  /** Secret that unlocks gallery admin mode via /galleri?admin=<key>. */
  GALLERY_ADMIN_KEY?: string;
}

declare module "cloudflare:workers" {
  export const env: Env;
}

declare namespace App {
  interface Locals {
    runtime?: {
      env: Env;
    };
    cfContext?: {
      waitUntil(promise: Promise<any>): void;
    };
    /** Feature flags resolved once per request by the middleware. */
    flags?: Record<string, boolean>;
  }
}
