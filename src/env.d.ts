/// <reference types="astro/client" />

interface Env {
  NOTION_API_KEY: string;
  NOTION_INVITES_DATABASE_ID: string;
  NOTION_GUESTS_DATABASE_ID: string;
  NOTION_TABLES_DATABASE_ID: string;
  NOTION_PROGRAM_DATABASE_ID?: string;
  NOTION_LOCATIONS_DATABASE_ID?: string;
  SITE_PIN?: string;
  SESSION_SECRET?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_REFRESH_TOKEN?: string;
  SPOTIFY_PLAYLIST_ID?: string;
  WEDDING_CACHE?: KVNamespace;
}

declare module "cloudflare:workers" {
  export const env: Env;
}

declare namespace App {
  interface Locals {
    runtime?: {
      env: Env;
      context: {
        waitUntil(promise: Promise<any>): void;
      };
    };
  }
}
