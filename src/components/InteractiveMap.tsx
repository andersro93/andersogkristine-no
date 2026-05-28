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
}

export interface WeddingLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  googleMapsUrl?: string;
  ikon?: string;
}

export default function InteractiveMap() {
  const [locations, setLocations] = useState<WeddingLocation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userLocationActive, setUserLocationActive] = useState(false);

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
      const popupHtml = `
        <div class="font-sans p-1 text-brand-title max-w-xs space-y-1">
          <h4 class="font-serif font-semibold text-lg border-b border-brand-title/15 pb-1">${loc.name}</h4>
          <p class="text-xs text-brand-text/75 uppercase tracking-wider font-medium">Type: ${loc.ikon}</p>
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
    });

    // Pan map to fit markers
    if (filtered.length > 0) {
      const bounds = L.latLngBounds(filtered.map((l) => [l.lat, l.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [locations, searchQuery]);

  // 4. Focus map on location clicked in sidebar
  const handleLocationClick = (loc: WeddingLocation) => {
    if (!mapRef.current) return;

    mapRef.current.setView([loc.lat, loc.lng], 16);

    const marker = markerInstancesRef.current.get(loc.id);
    if (marker) {
      marker.openPopup();
    }
  };

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
    <div className="flex flex-col lg:flex-row h-[75vh] lg:h-[70vh] rounded-2xl overflow-hidden border border-brand-title/10 shadow-lg bg-brand-bg/40 backdrop-blur-md">
      {/* Sidebar Panel */}
      <div className="w-full lg:w-80 bg-[#fcfbf9]/90 border-b lg:border-b-0 lg:border-r border-brand-title/10 flex flex-col h-[40%] lg:h-full z-20">
        {/* Search Header */}
        <div className="p-4 border-b border-brand-title/10 bg-brand-bg/20 space-y-3">
          <input
            type="text"
            placeholder="Søk etter steder..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-brand-title/20 bg-white font-sans text-sm text-brand-title placeholder-brand-text/50 focus:outline-none focus:ring-2 focus:ring-brand-title/50 shadow-inner"
          />

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

              return (
                <button
                  type="button"
                  key={loc.id}
                  onClick={() => handleLocationClick(loc)}
                  className="w-full text-left p-3 pt-4 rounded-lg flex items-center gap-3 hover:bg-brand-title/5 active:bg-brand-title/10 transition group border-0 bg-transparent cursor-pointer"
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
        className="flex-1 h-[60%] lg:h-full w-full z-10"
      />
    </div>
  );
}
