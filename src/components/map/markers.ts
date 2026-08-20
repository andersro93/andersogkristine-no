import * as L from "leaflet";
import { buildMarkerHtml, buildPopupHtml, getZoneColor } from "./popup";
import type { WeddingLocation } from "./types";

/** Leaflet marker for a location, with its popup bound. */
export function createLocationMarker(loc: WeddingLocation): L.Marker {
  return L.marker([loc.lat, loc.lng], {
    icon: L.divIcon({
      className: "custom-map-pin",
      html: buildMarkerHtml(loc.ikon || "default"),
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16],
    }),
  }).bindPopup(buildPopupHtml(loc), { minWidth: 180 });
}

/** Dashed zone polygon for a location, or null if it has no zone. */
export function createZonePolygon(loc: WeddingLocation): L.Polygon | null {
  if (!loc.zone || loc.zone.length < 3) return null;
  const color = getZoneColor(loc.zoneColor);
  return L.polygon(loc.zone, {
    color,
    fillColor: color,
    fillOpacity: 0.15,
    opacity: 0.5,
    weight: 2,
    dashArray: "6 4",
  });
}

/** Pulsing blue dot for the visitor's own position. */
export function createUserMarker(lat: number, lng: number): L.Marker {
  const icon = L.divIcon({
    className: "user-location-dot",
    html: `
            <div class="relative flex h-5 w-5">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-5 w-5 bg-blue-500 border-2 border-white shadow-md"></span>
            </div>
          `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  return L.marker([lat, lng], { icon }).bindPopup(
    '<div class="font-sans text-xs font-semibold p-1">Du er her</div>',
  );
}

/** Base map: CartoDB Voyager tiles with a warm filter, zoom control bottom-right. */
export function createBaseMap(container: HTMLDivElement): L.Map {
  const map = L.map(container, {
    center: [59.924, 10.758], // Grünerløkka, Oslo
    zoom: 13,
    zoomControl: false,
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    },
  ).addTo(map);
  const pane = container.querySelector<HTMLDivElement>(".leaflet-tile-pane");
  if (pane) {
    pane.style.filter =
      "sepia(0.2) contrast(0.95) saturate(0.9) brightness(1.02)";
  }
  return map;
}
