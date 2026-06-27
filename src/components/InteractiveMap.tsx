import { useCallback, useEffect, useRef, useState } from "react";

interface LeafletLatLngBounds {
  _northEast: { lat: number; lng: number };
  _southWest: { lat: number; lng: number };
}

interface LeafletLayer {
  _layerType?: string;
}

interface LeafletIcon {
  _iconType?: string;
}

interface LeafletMap {
  remove(): void;
  setView(latlng: [number, number], zoom: number): LeafletMap;
  fitBounds(
    bounds: LeafletLatLngBounds,
    options?: Record<string, unknown>,
  ): LeafletMap;
  removeLayer(layer: LeafletLayer): LeafletMap;
}

interface LeafletMarker extends LeafletLayer {
  addTo(map: LeafletMap): LeafletMarker;
  bindPopup(content: string, options?: Record<string, unknown>): LeafletMarker;
  openPopup(): LeafletMarker;
}

interface LeafletPolygon extends LeafletLayer {
  addTo(map: LeafletMap): LeafletPolygon;
  bindPopup(content: string, options?: Record<string, unknown>): LeafletPolygon;
}

interface LeafletLayerGroup extends LeafletLayer {
  addTo(map: LeafletMap): LeafletLayerGroup;
  addLayer(layer: LeafletLayer): LeafletLayerGroup;
  clearLayers(): LeafletLayerGroup;
}

interface LeafletStatic {
  map(
    element: HTMLDivElement | string,
    options?: Record<string, unknown>,
  ): LeafletMap;
  control: {
    zoom(options?: Record<string, unknown>): { addTo(map: LeafletMap): void };
  };
  tileLayer(
    url: string,
    options?: Record<string, unknown>,
  ): { addTo(map: LeafletMap): void };
  layerGroup(): LeafletLayerGroup;
  divIcon(options?: Record<string, unknown>): LeafletIcon;
  marker(
    latlng: [number, number],
    options?: Record<string, unknown>,
  ): LeafletMarker;
  latLngBounds(bounds: [number, number][]): LeafletLatLngBounds;
  polygon(
    latlngs: [number, number][],
    options?: Record<string, unknown>,
  ): LeafletPolygon;
}

export interface LocationActivity {
  type: "program" | "egentid";
  title: string;
  time?: string;
  description?: string;
  suggestedBy?: string;
  suggestedByEmoji?: string;
}

export interface WeddingLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  googleMapsUrl?: string;
  ikon?: string;
  activities?: LocationActivity[];
  zone?: [number, number][];
  zoneColor?: string;
}

export default function InteractiveMap() {
  const [locations, setLocations] = useState<WeddingLocation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userLocationActive, setUserLocationActive] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    null,
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (window.innerWidth >= 1024) {
      setIsSidebarOpen(true);
    }
  }, []);

  // Invalidate map size on window resize
  useEffect(() => {
    const handleResize = () => {
      mapRef.current?.invalidateSize();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersGroupRef = useRef<LeafletLayerGroup | null>(null);
  const userMarkerRef = useRef<LeafletMarker | null>(null);
  const markerInstancesRef = useRef<Map<string, LeafletMarker>>(new Map());

  // 1. Fetch locations on mount
  useEffect(() => {
    fetch("/api/locations")
      .then((res) => {
        if (!res.ok) throw new Error("Klarte ikke å hente lokasjoner");
        return res.json() as Promise<WeddingLocation[]>;
      })
      .then((data) => {
        setLocations(data);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError(
          "Det oppstod en feil ved lasting av kartet. Vennligst prøv igjen.",
        );
        setIsLoading(false);
      });
  }, []);

  // Helper to find the tile pane for custom CSS injection
  const getMapPane = useCallback(() => {
    if (!mapContainerRef.current) return null;
    return mapContainerRef.current.querySelector(
      ".leaflet-tile-pane",
    ) as HTMLDivElement;
  }, []);

  // 2. Initialize Leaflet map once loading is done
  useEffect(() => {
    if (isLoading || error || !mapContainerRef.current || mapRef.current)
      return;

    const L = (window as unknown as { L?: LeafletStatic }).L;
    if (!L) {
      setError(
        "Leaflet.js ble ikke lastet inn. Vennligst prøv å oppdatere siden.",
      );
      return;
    }

    // Initialize map centered around Grünerløkka, Oslo
    const map = L.map(mapContainerRef.current, {
      center: [59.924, 10.758],
      zoom: 13,
      zoomControl: false, // Position custom zoom control later
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Warm elegant map tiles from CartoDB (Positron without labels, then add labels, or Positron standard)
    // We style it using CSS filters applied to the tile pane
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      },
    ).addTo(map);

    // Add marker layer group
    const markersGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    markersGroupRef.current = markersGroup;

    // Apply warm styling filter to the leaflet pane
    const mapPane = getMapPane();
    if (mapPane) {
      mapPane.style.filter =
        "sepia(0.2) contrast(0.95) saturate(0.9) brightness(1.02)";
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [isLoading, error, getMapPane]);

  // 3. Update markers when locations or search query changes
  useEffect(() => {
    const L = (window as unknown as { L?: LeafletStatic }).L;
    if (!mapRef.current || !markersGroupRef.current || !L) return;
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;

    // Filter locations based on search query
    const filtered = locations.filter((loc) =>
      loc.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    // Clear old markers
    markersGroup.clearLayers();
    markerInstancesRef.current.clear();

    if (filtered.length === 0) return;

    // Define custom marker generator based on Ikon type
    const createCustomMarker = (ikonType: string) => {
      let iconSvg = "";
      let colorClass = "bg-brand-title text-brand-bg border-brand-title";

      switch (ikonType) {
        case "ring":
          colorClass = "bg-[#c5a880] text-white border-[#b3956b]"; // Matte gold
          iconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8l1 -2.5l2 1l-1 2.5" />
            </svg>
          `;
          break;
        case "church":
          colorClass = "bg-[#8d7c68] text-white border-[#756451]"; // Clay gray-brown
          iconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 21v-4a2 2 0 0 1 4 0v4" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v5m-2 -3h4M6 21v-7l6-6l6 7v7M3 21h18" />
            </svg>
          `;
          break;
        case "hotel":
          colorClass = "bg-[#7c8b74] text-white border-[#64735c]"; // Sage Green
          iconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3c.13 0 .26 0 .39 0a7.5 7.5 0 0 0 7.92 12.44a9 9 0 1 1 -8.31 -12.44z" />
            </svg>
          `;
          break;
        case "park":
          colorClass = "bg-[#627a69] text-white border-[#4d6353]"; // Soft Forest
          iconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 10a4 4 0 0 0 -4 -4h-1a1 1 0 0 0 -1 1v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1 -1V7a1 1 0 0 0 -1 -1h-3a4 4 0 0 0 -4 4" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 10v10" />
            </svg>
          `;
          break;
        case "food":
          colorClass = "bg-[#9e7667] text-white border-[#845c4e]"; // Terracotta
          iconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 3h3v7a3 3 0 0 1 -3 3v8h-1v-8a3 3 0 0 1 -3 -3v-7h1v4h1v-4h1v4h1v-4z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 11h3v-8h-3a4 4 0 0 0 -4 4v4h1" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 11v10" />
            </svg>
          `;
          break;
        case "buss":
          colorClass = "bg-[#4a90e2] text-white border-[#357ab8]"; // Bus blue
          iconSvg = `
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V2H4zm14 16H6V4h12v14zM8 6h8v4H8V6zm0 8h8v2H8v-2z" />
              </svg>
            `;
          break;
        case "parkering":
          colorClass = "bg-[#6b7280] text-white border-[#4b5563]"; // Neutral gray
          iconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="w-5 h-5">
              <rect x="4" y="3" width="16" height="18" rx="2" ry="2" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-6h3.5a2.5 2.5 0 0 0 0-5H9" />
            </svg>
          `;
          break;
        default:
          colorClass = "bg-[#d0bfa8] text-white border-[#bfae96]"; // Beige fallback
          iconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1 -6 0 3 3 0 0 1 6 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.14 -7.5 11.25 -7.5 11.25s-7.5 -4.11 -7.5 -11.25a7.5 7.5 0 0 1 15 0z" />
            </svg>
          `;
      }

      return L.divIcon({
        className: "custom-map-pin",
        html: `<div class="flex items-center justify-center w-8 h-8 rounded-full border-2 shadow-md transition-all duration-300 hover:scale-110 ${colorClass}">${iconSvg}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
      });
    };

    // Plot each marker
    filtered.forEach((loc) => {
      const programActs = (loc.activities || []).filter(
        (a) => a.type === "program",
      );
      const eigentidActs = (loc.activities || []).filter(
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
                  <span class="font-bold text-brand-title">${a.time}</span>
                  <span class="text-brand-text/90">${a.title}</span>
                </li>
              `,
                )
                .join("")}
            </ul>
          </div>
        `;
      }

      if (eigentidActs.length > 0) {
        activitiesHtml += `
          <div class="mt-2 pt-2 border-t border-brand-title/10">
            <h5 class="text-[10px] font-bold uppercase tracking-wider text-brand-title/60 mb-1">Anbefalinger / Egentid</h5>
            <ul class="space-y-2 text-xs list-none pl-0 my-0">
              ${eigentidActs
                .map(
                  (a) => `
                <li class="space-y-0.5 my-1">
                  <div class="font-medium text-brand-title flex items-center gap-1">
                    <span>${a.suggestedByEmoji || "📍"}</span>
                    <span>${a.suggestedBy}</span>
                  </div>
                  <p class="text-[11px] text-brand-text/80 leading-snug my-0">${a.title}</p>
                </li>
              `,
                )
                .join("")}
            </ul>
          </div>
        `;
      }

      let typeLabel = "Lokasjon";
      if (loc.ikon === "ring") typeLabel = "Bryllupsfest";
      else if (loc.ikon === "church") typeLabel = "Kirke";
      else if (loc.ikon === "hotel") typeLabel = "Hotell";
      else if (loc.ikon === "park") typeLabel = "Park";
      else if (loc.ikon === "food") typeLabel = "Mat & Drikke";
      else if (loc.ikon === "buss") typeLabel = "Transport";
      else if (loc.ikon === "parkering") typeLabel = "Parkering";

      const popupHtml = `
        <div class="font-sans p-1 text-brand-title max-w-xs space-y-1">
          <div class="flex items-center justify-between border-b border-brand-title/15 pb-1 gap-4">
            <h4 class="font-serif font-semibold text-base leading-tight my-0">${loc.name}</h4>
            <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-brand-title/10 text-brand-title rounded shrink-0">${typeLabel}</span>
          </div>
          ${activitiesHtml}
          ${
            loc.googleMapsUrl
              ? `<a href="${loc.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs font-semibold text-brand-title hover:underline mt-2 pt-1 block">Veibeskrivelse i Google Maps &rarr;</a>`
              : ""
          }
        </div>
      `;

      const marker = L.marker([loc.lat, loc.lng], {
        icon: createCustomMarker(loc.ikon || "default"),
      }).bindPopup(popupHtml, { minWidth: 180 });

      markersGroup.addLayer(marker);
      markerInstancesRef.current.set(loc.id, marker);

      // Render zone polygon if coordinates are provided
      if (loc.zone && loc.zone.length >= 3) {
        const zoneColorMap: Record<string, { fill: string; border: string }> = {
          blue: { fill: "#3b82f6", border: "#3b82f6" },
          red: { fill: "#ef4444", border: "#ef4444" },
          green: { fill: "#22c55e", border: "#22c55e" },
          yellow: { fill: "#eab308", border: "#eab308" },
          purple: { fill: "#a855f7", border: "#a855f7" },
          orange: { fill: "#f97316", border: "#f97316" },
          gray: { fill: "#6b7280", border: "#6b7280" },
        };
        const colors = zoneColorMap[(loc.zoneColor || "blue").toLowerCase()] || zoneColorMap.blue;
        const polygon = L.polygon(loc.zone, {
          color: colors.border,
          fillColor: colors.fill,
          fillOpacity: 0.15,
          opacity: 0.5,
          weight: 2,
          dashArray: "6 4",
        });
        markersGroup.addLayer(polygon);
      }
    });

    // Pan map to fit markers
    if (filtered.length > 0) {
      const bounds = L.latLngBounds(filtered.map((l) => [l.lat, l.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [locations, searchQuery]);

  // 4. Focus map on location clicked in sidebar
  const handleLocationClick = useCallback((loc: WeddingLocation) => {
    setSelectedLocationId(loc.id);
    if (!mapRef.current) return;

    mapRef.current.setView([loc.lat, loc.lng], 16);

    const marker = markerInstancesRef.current.get(loc.id);
    if (marker) {
      marker.openPopup();
    }

    // Collapse sidebar on mobile to show the map
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  }, []);

  // 4b. Focus location from URL query parameter (loc) on mount/load
  useEffect(() => {
    if (isLoading || locations.length === 0 || !mapRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const targetLocId = params.get("loc");
    if (targetLocId) {
      const targetLoc = locations.find((l) => l.id === targetLocId);
      if (targetLoc) {
        // Subtle delay to ensure markers have finished rendering on map container
        const timer = setTimeout(() => {
          handleLocationClick(targetLoc);
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [isLoading, locations, handleLocationClick]);

  // 5. Geolocation handler
  const handleLocateUser = () => {
    if (!navigator.geolocation) {
      alert("Nettleseren din støtter ikke deling av posisjon.");
      return;
    }

    const L = (window as unknown as { L?: LeafletStatic }).L;
    const map = mapRef.current;
    if (!L || !map) return;

    setUserLocationActive(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        // Custom pulsing dot for user location
        const userIcon = L.divIcon({
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

        // Remove old marker if exists
        if (userMarkerRef.current) {
          map.removeLayer(userMarkerRef.current);
        }

        const marker = L.marker([latitude, longitude], { icon: userIcon })
          .addTo(map)
          .bindPopup(
            '<div class="font-sans text-xs font-semibold p-1">Du er her</div>',
          );

        userMarkerRef.current = marker;
        map.setView([latitude, longitude], 15);
        marker.openPopup();
        setUserLocationActive(false);
      },
      (err) => {
        console.error(err);
        alert(
          "Klarte ikke å hente posisjonen din. Vennligst sjekk stedstjenester.",
        );
        setUserLocationActive(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const filteredLocations = locations.filter((loc) =>
    loc.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[450px] space-y-4">
        <div className="animate-spin h-10 w-10 text-brand-title border-4 border-brand-title/20 border-t-brand-title rounded-full"></div>
        <p className="font-serif italic text-brand-text/70">
          Laster inn kartet...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center p-12 max-w-md mx-auto space-y-4">
        <p className="text-red-700 font-sans">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-brand-title text-brand-bg px-6 py-2 rounded-lg font-sans font-medium hover:bg-brand-title/95 hover:shadow-md transition"
        >
          Prøv igjen
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col lg:flex-row h-[75vh] lg:h-[70vh] rounded-2xl overflow-hidden border border-brand-title/10 shadow-lg bg-brand-bg/40 backdrop-blur-md relative ${
      isSidebarOpen ? "sidebar-open" : ""
    }`}>
      <style>{`
        @media (max-width: 1023px) {
          .leaflet-bottom {
            bottom: 76px !important;
            transition: bottom 300ms ease-in-out;
          }
          .sidebar-open .leaflet-bottom {
            bottom: calc(50% + 8px) !important;
          }
        }
      `}</style>

      {/* Sidebar Panel */}
      <div className={`bg-[#fcfbf9]/90 border-brand-title/10 flex flex-col z-20 transition-all duration-300 
        absolute bottom-0 left-0 right-0 border-t
        lg:relative lg:bottom-auto lg:left-auto lg:right-auto lg:border-t-0 lg:border-r lg:w-80 lg:h-full
        ${isSidebarOpen ? "h-[50%]" : "h-[72px]"}
      `}>
        {/* Search Header */}
        <div className="p-3 border-b border-brand-title/10 bg-brand-bg/20 flex flex-col gap-2 shrink-0">
          {/* Decorative Drag/Grab Handle (mobile only) */}
          <div 
            className="lg:hidden w-10 h-1 bg-brand-title/20 rounded-full mx-auto cursor-pointer"
            onClick={() => setIsSidebarOpen(prev => !prev)}
          />
          
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Søk etter steder..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!isSidebarOpen) setIsSidebarOpen(true); // Auto-expand when typing
              }}
              className="flex-1 px-3 py-2 rounded-lg border border-brand-title/20 bg-white font-sans text-sm text-brand-title placeholder-brand-text/50 focus:outline-none focus:ring-2 focus:ring-brand-title/50 shadow-inner"
            />
            
            {/* Collapse/Expand Button (mobile only) */}
            <button
              type="button"
              onClick={() => setIsSidebarOpen(prev => !prev)}
              className="lg:hidden p-2 rounded-lg border border-brand-title/20 bg-brand-bg text-brand-title hover:bg-brand-title/5 transition"
              aria-label={isSidebarOpen ? "Kollaps panel" : "Ekspander panel"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
                className={`w-4 h-4 transition-transform duration-300 ${
                  isSidebarOpen ? "rotate-180" : ""
                }`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </div>

          <div className={`${isSidebarOpen ? "block" : "hidden lg:block"} mt-1`}>
            <button
              type="button"
              onClick={handleLocateUser}
              disabled={userLocationActive}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-bg border border-brand-title/20 rounded-lg text-xs font-semibold text-brand-title hover:bg-brand-title/5 hover:border-brand-title/40 active:bg-brand-title/10 transition disabled:opacity-50 select-none shadow-xs"
            >
              {userLocationActive ? (
                <>
                  <div className="animate-spin h-3.5 w-3.5 border-2 border-brand-title/20 border-t-brand-title rounded-full"></div>
                  <span>Henter posisjon...</span>
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-4 h-4"
                  >
                    <title>Vis posisjon</title>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0z"
                    />
                  </svg>
                  <span>Vis min posisjon</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Location List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 divide-y divide-brand-title/5 select-none scrollbar-thin">
          {filteredLocations.length > 0 ? (
            filteredLocations.map((loc) => {
              // Icon mapping for sidebar display
              let iconSymbol = "📍";
              if (loc.ikon === "ring") iconSymbol = "💍";
              if (loc.ikon === "church") iconSymbol = "⛪";
              if (loc.ikon === "hotel") iconSymbol = "🏨";
              if (loc.ikon === "park") iconSymbol = "🌳";
              if (loc.ikon === "food") iconSymbol = "🍻";
              if (loc.ikon === "parkering") iconSymbol = "🅿️";

              const isSelected = loc.id === selectedLocationId;
              const activeBgClass = isSelected
                ? "bg-brand-title/10 border-l-4 border-l-brand-title pl-2"
                : "hover:bg-brand-title/5 active:bg-brand-title/10 border-l-4 border-l-transparent";

              return (
                <button
                  type="button"
                  key={loc.id}
                  onClick={() => handleLocationClick(loc)}
                  className={`w-full text-left p-3 pt-4 rounded-lg flex items-center gap-3 transition group border-0 bg-transparent cursor-pointer ${activeBgClass}`}
                >
                  <span className="text-xl shrink-0 group-hover:scale-110 transition-transform">
                    {iconSymbol}
                  </span>
                  <div className="min-w-0">
                    <p className="font-serif font-semibold text-brand-title text-base group-hover:text-brand-text transition-colors truncate">
                      {loc.name}
                    </p>
                    <p className="text-[10px] text-brand-text/50 font-sans uppercase tracking-wider font-bold capitalize pt-0.5">
                      {loc.ikon === "default" ? "Lokasjon" : loc.ikon}
                    </p>
                  </div>
                </button>
              );
            })
          ) : (
            <p className="text-center font-sans text-sm text-brand-text/60 py-8">
              Ingen steder matcher søket.
            </p>
          )}
        </div>
      </div>

      {/* Map Element */}
      <div
        ref={mapContainerRef}
        className="w-full h-full lg:flex-1 z-10"
      />
    </div>
  );
}
