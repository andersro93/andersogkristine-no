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
import { Toast, useToast } from "./ui/useToast";

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
  const { toast, showToast } = useToast();

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

    return () => {
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
      showToast("Nettleseren din støtter ikke deling av posisjon.", "error");
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
        showToast(
          "Klarte ikke å hente posisjonen din. Vennligst sjekk stedstjenester.",
          "error",
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
      className={`flex flex-col lg:flex-row h-[75vh] lg:h-[70vh] rounded-2xl overflow-hidden border border-brand-title/10 shadow-lg bg-brand-bg/40 backdrop-blur-md relative ${
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

      <Toast toast={toast} />
    </div>
  );
}
