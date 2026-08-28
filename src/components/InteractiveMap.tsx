import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocationSidebar } from "./map/LocationSidebar";
import {
  createBaseMap,
  createLocationMarker,
  createUserMarker,
  createZonePolygon,
} from "./map/markers";
import type { WeddingLocation } from "./map/types";

export type { LocationActivity, WeddingLocation } from "./map/types";

const DESKTOP_MIN_WIDTH = 1024;

/** Leaflet map of wedding locations with a searchable sidebar and geolocation. */
export default function InteractiveMap() {
  const [locations, setLocations] = useState<WeddingLocation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    null,
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showTouchHint, setShowTouchHint] = useState(false);

  const touchHintTimerRef = useRef<number | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const markerInstancesRef = useRef<Map<string, L.Marker>>(new Map());

  const filteredLocations = useMemo(
    () =>
      locations.filter((loc) =>
        loc.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [locations, searchQuery],
  );

  // Sidebar starts open on desktop
  useEffect(() => {
    if (window.innerWidth >= DESKTOP_MIN_WIDTH) setIsSidebarOpen(true);
  }, []);

  // Keep Leaflet's size in sync with the window
  useEffect(() => {
    const handleResize = () => mapRef.current?.invalidateSize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 1. Fetch locations on mount
  useEffect(() => {
    fetch("/api/locations")
      .then((res) => {
        if (!res.ok) throw new Error("Klarte ikke å hente lokasjoner");
        return res.json() as Promise<WeddingLocation[]>;
      })
      .then((data) => setLocations(data))
      .catch((err) => {
        console.error(err);
        setError(
          "Det oppstod en feil ved lasting av kartet. Vennligst prøv igjen.",
        );
      })
      .finally(() => setIsLoading(false));
  }, []);

  // 2. Initialize the Leaflet map once loading is done
  useEffect(() => {
    if (isLoading || error || !mapContainerRef.current || mapRef.current)
      return;

    const map = createBaseMap(mapContainerRef.current);
    mapRef.current = map;
    markersGroupRef.current = L.layerGroup().addTo(map);

    // On touch devices one finger scrolls the page (so the map doesn't trap
    // scrolling); two fingers pan the map. Leaflet only sets touch-action to
    // block page scroll while its drag handler is enabled.
    const container = mapContainerRef.current;
    let cleanupTouch: (() => void) | undefined;
    if (window.matchMedia("(pointer: coarse)").matches) {
      map.dragging.disable();

      const showHint = () => {
        setShowTouchHint(true);
        if (touchHintTimerRef.current)
          window.clearTimeout(touchHintTimerRef.current);
        touchHintTimerRef.current = window.setTimeout(
          () => setShowTouchHint(false),
          1500,
        );
      };
      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length >= 2) {
          map.dragging.enable();
          setShowTouchHint(false);
        }
      };
      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 1 && !map.dragging.enabled()) showHint();
      };
      const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) map.dragging.disable();
      };
      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: true });
      container.addEventListener("touchend", onTouchEnd, { passive: true });
      cleanupTouch = () => {
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
      };
    }

    return () => {
      cleanupTouch?.();
      if (touchHintTimerRef.current)
        window.clearTimeout(touchHintTimerRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [isLoading, error]);

  // 3. (Re)draw markers and zones when locations or the search query change
  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();
    markerInstancesRef.current.clear();
    if (filteredLocations.length === 0) return;

    for (const loc of filteredLocations) {
      const marker = createLocationMarker(loc);
      markersGroup.addLayer(marker);
      markerInstancesRef.current.set(loc.id, marker);
      const zone = createZonePolygon(loc);
      if (zone) markersGroup.addLayer(zone);
    }

    map.fitBounds(
      L.latLngBounds(filteredLocations.map((l) => [l.lat, l.lng])),
      { padding: [50, 50], maxZoom: 15 },
    );
  }, [filteredLocations]);

  // 4. Focus a location (sidebar click or ?loc= param)
  const focusLocation = useCallback((loc: WeddingLocation) => {
    setSelectedLocationId(loc.id);
    if (!mapRef.current) return;
    mapRef.current.setView([loc.lat, loc.lng], 16);
    markerInstancesRef.current.get(loc.id)?.openPopup();
    if (window.innerWidth < DESKTOP_MIN_WIDTH) setIsSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (isLoading || locations.length === 0 || !mapRef.current) return;
    const targetId = new URLSearchParams(window.location.search).get("loc");
    const target = targetId && locations.find((l) => l.id === targetId);
    if (!target) return;
    // Small delay so markers have rendered before we open the popup
    const timer = setTimeout(() => focusLocation(target), 300);
    return () => clearTimeout(timer);
  }, [isLoading, locations, focusLocation]);

  // 5. Geolocation
  const handleLocateUser = () => {
    if (!navigator.geolocation) {
      alert("Nettleseren din støtter ikke deling av posisjon.");
      return;
    }
    const map = mapRef.current;
    if (!map) return;

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude } }) => {
        if (userMarkerRef.current) map.removeLayer(userMarkerRef.current);
        const marker = createUserMarker(latitude, longitude).addTo(map);
        userMarkerRef.current = marker;
        map.setView([latitude, longitude], 15);
        marker.openPopup();
        setIsLocating(false);
      },
      (err) => {
        console.error(err);
        alert(
          "Klarte ikke å hente posisjonen din. Vennligst sjekk stedstjenester.",
        );
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

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
    <div
      className={`flex flex-col lg:flex-row h-[75dvh] lg:h-[70vh] rounded-2xl overflow-hidden border border-brand-title/10 shadow-lg bg-brand-bg/40 backdrop-blur-md relative ${
        isSidebarOpen ? "sidebar-open" : ""
      }`}
    >
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

      <LocationSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((prev) => !prev)}
        searchQuery={searchQuery}
        onSearchChange={(value) => {
          setSearchQuery(value);
          if (!isSidebarOpen) setIsSidebarOpen(true); // Auto-expand when typing
        }}
        locations={filteredLocations}
        selectedId={selectedLocationId}
        onSelect={focusLocation}
        onLocate={handleLocateUser}
        isLocating={isLocating}
      />

      {/* Map Element */}
      <div ref={mapContainerRef} className="w-full h-full lg:flex-1 z-10" />

      {/* One-finger pan hint (touch devices) */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 z-30 flex items-center justify-center pointer-events-none transition-opacity duration-300 ${
          showTouchHint ? "opacity-100" : "opacity-0"
        }`}
      >
        <p className="bg-black/70 text-white text-sm font-sans px-5 py-3 rounded-lg shadow-lg">
          Bruk to fingre for å flytte kartet
        </p>
      </div>
    </div>
  );
}
