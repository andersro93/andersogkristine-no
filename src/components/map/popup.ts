import { escapeHtml } from "../../utils/html";
import type { WeddingLocation } from "./types";

/** Human label for a location's emoji category (sidebar + popup badge). */
export function getLabelForEmoji(emoji?: string): string {
  switch (emoji) {
    case "💍":
    case "🏛️":
      return "Bryllupsfest";
    case "⛪":
      return "Kirke";
    case "🏨":
      return "Hotell";
    case "🌳":
    case "🌲":
      return "Park";
    case "🍻":
    case "🍔":
    case "🍽️":
      return "Mat & Drikke";
    case "🚌":
    case "🚃":
      return "Transport";
    case "🅿️":
      return "Parkering";
    default:
      return "Lokasjon";
  }
}

/** Tailwind colour classes for a marker pin by emoji category. */
export function getMarkerColorClass(emoji: string): string {
  switch (emoji) {
    case "💍":
    case "🏛️":
      return "bg-[#c5a880] text-white border-[#b3956b]"; // Matte gold
    case "⛪":
      return "bg-[#8d7c68] text-white border-[#756451]"; // Clay gray-brown
    case "🏨":
      return "bg-[#7c8b74] text-white border-[#64735c]"; // Sage Green
    case "🌳":
    case "🌲":
      return "bg-[#627a69] text-white border-[#4d6353]"; // Soft Forest
    case "🍻":
    case "🍔":
    case "🍽️":
      return "bg-[#9e7667] text-white border-[#845c4e]"; // Terracotta
    case "🚌":
    case "🚃":
      return "bg-[#4a90e2] text-white border-[#357ab8]"; // Bus blue
    case "🅿️":
      return "bg-[#6b7280] text-white border-[#4b5563]"; // Neutral gray
    default:
      return "bg-[#d0bfa8] text-white border-[#bfae96]"; // Beige fallback
  }
}

const ZONE_COLORS: Record<string, string> = {
  blue: "#3b82f6",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  purple: "#a855f7",
  orange: "#f97316",
  gray: "#6b7280",
};

/** Hex colour for a zone polygon (Notion "Sone-farge" select), default blue. */
export function getZoneColor(name?: string): string {
  return ZONE_COLORS[(name || "blue").toLowerCase()] ?? ZONE_COLORS.blue;
}

/** HTML for the marker pin (rendered by Leaflet's divIcon). */
export function buildMarkerHtml(emoji: string): string {
  return `<div class="flex items-center justify-center w-8 h-8 rounded-full border-2 shadow-md transition-all duration-300 hover:scale-110 ${getMarkerColorClass(emoji)} text-lg leading-none select-none">${escapeHtml(emoji)}</div>`;
}

/** HTML for a location's popup: name, category badge, program, recommendations, directions. */
export function buildPopupHtml(loc: WeddingLocation): string {
  const programActs = (loc.activities || []).filter(
    (a) => a.type === "program",
  );
  const egentidActs = (loc.activities || []).filter(
    (a) => a.type === "egentid",
  );

  let activitiesHtml = "";
  if (programActs.length > 0) {
    activitiesHtml += `
          <div class="mt-2">
            <h5 class="text-[10px] font-bold uppercase tracking-wider text-brand-title/60 mb-1">Program</h5>
            <ul class="space-y-1 text-xs list-none pl-0 my-0">
              ${programActs
                .map(
                  (a) => `
                <li class="flex items-start gap-1.5 my-0.5">
                  <span class="font-bold text-brand-title">${escapeHtml(a.time)}</span>
                  <span class="text-brand-text/90">${escapeHtml(a.title)}</span>
                </li>
              `,
                )
                .join("")}
            </ul>
          </div>
        `;
  }
  if (egentidActs.length > 0) {
    activitiesHtml += `
          <div class="mt-2 pt-2 border-t border-brand-title/10">
            <h5 class="text-[10px] font-bold uppercase tracking-wider text-brand-title/60 mb-1">Anbefalinger / Egentid</h5>
            <ul class="space-y-2 text-xs list-none pl-0 my-0">
              ${egentidActs
                .map(
                  (a) => `
                <li class="space-y-0.5 my-1">
                  <div class="font-medium text-brand-title flex items-center gap-1">
                    <span>${escapeHtml(a.suggestedByEmoji || "📍")}</span>
                    <span>${escapeHtml(a.suggestedBy)}</span>
                  </div>
                  <p class="text-[11px] text-brand-text/80 leading-snug my-0">${escapeHtml(a.title)}</p>
                </li>
              `,
                )
                .join("")}
            </ul>
          </div>
        `;
  }

  return `
        <div class="font-sans p-1 text-brand-title max-w-xs space-y-1">
          <div class="flex items-center justify-between border-b border-brand-title/15 pb-1 gap-4">
            <h4 class="font-serif font-semibold text-base leading-tight my-0">${escapeHtml(loc.name)}</h4>
            <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-brand-title/10 text-brand-title rounded shrink-0">${escapeHtml(getLabelForEmoji(loc.ikon))}</span>
          </div>
          ${activitiesHtml}
          ${
            loc.googleMapsUrl
              ? `<a href="${escapeHtml(loc.googleMapsUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs font-semibold text-brand-title hover:underline mt-2 pt-1 block">Veibeskrivelse i Google Maps &rarr;</a>`
              : ""
          }
        </div>
      `;
}
