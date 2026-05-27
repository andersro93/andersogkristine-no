/// <reference types="astro/client" />

declare module 'cloudflare:workers' {
  interface Env {
    NOTION_API_KEY: string;
    NOTION_INVITES_DATABASE_ID: string;
    NOTION_GUESTS_DATABASE_ID: string;
    NOTION_TABLES_DATABASE_ID: string;
    SITE_PIN?: string;
    SESSION_SECRET?: string;
    WEDDING_CACHE?: KVNamespace;
  }
  export const env: Env;
}
