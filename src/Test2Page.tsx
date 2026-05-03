import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Fuel, Loader2, MapPin, Navigation } from 'lucide-react';
import { BRAND_SVG_LOGOS, detectBrandKey, svgToDataUrl } from './brandSvgLogos';

type Station = {
  id: string;
  name: string;
  address: string | null;
  fuelType: string | null;
  currencyCode: string;
  price: number;
  lat: number;
  lon: number;
  distanceKm?: number;
  image: string | null;
};

type FuelChoice = 'REGULAR_UNLEADED' | 'MIDGRADE' | 'PREMIUM' | 'DIESEL';
type SortMode = 'price' | 'distance';
type LocationFix = {
  lat: number;
  lon: number;
  accuracy?: number;
  detectedAt: string;
  source: 'cache' | 'quick' | 'precise';
};

const FUEL_CHOICES: { label: string; value: FuelChoice }[] = [
  { label: 'Regular', value: 'REGULAR_UNLEADED' },
  { label: 'Mid', value: 'MIDGRADE' },
  { label: 'Premium', value: 'PREMIUM' },
  { label: 'Diesel', value: 'DIESEL' },
];

const LOCATION_CACHE_KEY = 'test_detected_location';
const LOCATION_CACHE_MAX_AGE_MS = 15 * 60 * 1000;

declare global {
  interface Window {
    google?: any;
    __luxefuelMapInit?: () => void;
  }
}

const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#121212' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#d4d4d4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111111' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#343434' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1b1b1b' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b0b0b' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3a3a3a' }] },
];

export default function Test2Page() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const markerElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const userMarkerRef = useRef<any>(null);
  const focusMarkerRef = useRef<any>(null);
  const focusResetTimerRef = useRef<number | null>(null);
  const radiusCircleRef = useRef<any>(null);
  const radiusAnimationRef = useRef<number | null>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const discoveryControllerRef = useRef<AbortController | null>(null);
  const discoveryRequestedRef = useRef(false);
  const fetchSequenceRef = useRef(0);
  const locationSequenceRef = useRef(0);
  const [mapMounted, setMapMounted] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(20);
  const [fuelType, setFuelType] = useState<FuelChoice>('REGULAR_UNLEADED');
  const [sortMode, setSortMode] = useState<SortMode>('price');
  const [showRadiusRing, setShowRadiusRing] = useState(true);
  const [brandLogoMarkers, setBrandLogoMarkers] = useState(true);
  const [stations, setStations] = useState<Station[]>([]);
  const [cheapestAroundYou, setCheapestAroundYou] = useState<Station | null>(null);
  const [discoveryRadiusKm, setDiscoveryRadiusKm] = useState(50);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [hoveredStationId, setHoveredStationId] = useState<string | null>(null);
  const [detected, setDetected] = useState<LocationFix | null>(null);
  const [stage, setStage] = useState<'intro' | 'map'>('intro');

  const apiKey = useMemo(() => import.meta.env.VITE_GOOGLE_MAPS_API_KEY, []);

  const loadGoogleMaps = async () => {
    console.info('[test2] loadGoogleMaps:start', { hasGoogle: !!window.google?.maps });
    if (window.google?.maps) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector('script[data-google-maps="true"]') as HTMLScriptElement | null;
      if (existing) {
        console.info('[test2] loadGoogleMaps:existing-script-found');
        const started = Date.now();
        const timer = window.setInterval(() => {
          if (window.google?.maps) {
            window.clearInterval(timer);
            console.info('[test2] loadGoogleMaps:existing-script-ready');
            resolve();
          } else if (Date.now() - started > 10000) {
            window.clearInterval(timer);
            console.error('[test2] loadGoogleMaps:existing-script-timeout');
            reject(new Error('Timed out waiting for Google Maps API'));
          }
        }, 100);
        return;
      }

      console.info('[test2] loadGoogleMaps:inject-script');
      window.__luxefuelMapInit = () => resolve();
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&callback=__luxefuelMapInit`;
      script.async = true;
      script.defer = true;
      script.dataset.googleMaps = 'true';
      script.onerror = () => {
        console.error('[test2] loadGoogleMaps:script-error');
        reject(new Error('Failed to load Google Maps script'));
      };
      document.head.appendChild(script);
    });
    console.info('[test2] loadGoogleMaps:done');
  };

  const clearMarkers = () => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    markerElementsRef.current.clear();
  };

  const fitMapToSearchRadius = (centerOverride?: { lat: number; lon: number } | null) => {
    const center = centerOverride ?? detected;
    if (!googleMapRef.current || !center || !window.google?.maps) return;
    const map = googleMapRef.current;
    window.google?.maps?.event?.trigger?.(googleMapRef.current, 'resize');
    const latDelta = radiusKm / 111.32;
    const safeCos = Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
    const lonDelta = radiusKm / (111.32 * safeCos);
    const bounds = new window.google.maps.LatLngBounds(
      new window.google.maps.LatLng(center.lat - latDelta, center.lon - lonDelta),
      new window.google.maps.LatLng(center.lat + latDelta, center.lon + lonDelta),
    );
    window.setTimeout(() => {
      map.fitBounds(bounds, {
        top: 56,
        right: 56,
        bottom: 56,
        left: 56,
      });
    }, 80);
  };

  const animateCircleRadius = (circle: any, nextRadiusMeters: number) => {
    if (!window.google?.maps) return;
    if (radiusAnimationRef.current) window.cancelAnimationFrame(radiusAnimationRef.current);

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const startRadius = Number(circle.getRadius?.() ?? nextRadiusMeters);
    if (prefersReducedMotion || Math.abs(startRadius - nextRadiusMeters) < 10) {
      circle.setRadius(nextRadiusMeters);
      return;
    }

    const startedAt = performance.now();
    const duration = 520;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = easeOutCubic(progress);
      circle.setRadius(startRadius + (nextRadiusMeters - startRadius) * eased);
      if (progress < 1) {
        radiusAnimationRef.current = window.requestAnimationFrame(tick);
      } else {
        radiusAnimationRef.current = null;
      }
    };

    radiusAnimationRef.current = window.requestAnimationFrame(tick);
  };

  const drawUserMarker = (center: { lat: number; lon: number } | null) => {
    if (!center || !googleMapRef.current || !window.google?.maps) return;
    if (!userMarkerRef.current) {
      const markerEl = document.createElement('div');
      markerEl.innerHTML = `
        <div style="
          display:flex;align-items:center;gap:7px;
          transform:translate(-50%,-50%);
          font-family:'Space Grotesk',sans-serif;
        ">
          <div style="
            width:14px;height:14px;border-radius:999px;
            background:#ffffff;border:2px solid #111111;
            box-shadow:0 0 0 6px rgba(255,255,255,0.16),0 10px 20px rgba(0,0,0,0.35);
          "></div>
          <div style="
            border:1px solid rgba(255,255,255,0.22);
            background:rgba(0,0,0,0.72);
            color:#ffffff;
            border-radius:999px;
            padding:4px 8px;
            font-size:10px;
            font-weight:800;
            letter-spacing:0.12em;
            text-transform:uppercase;
            white-space:nowrap;
            backdrop-filter:blur(10px);
          ">Your location</div>
        </div>
      `;

      const overlay = new window.google.maps.OverlayView();
      overlay.onAdd = function onAdd() {
        this.getPanes()?.overlayMouseTarget.appendChild(markerEl);
      };
      overlay.draw = function draw() {
        const projection = this.getProjection();
        if (!projection || !center) return;
        const pos = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(center.lat, center.lon));
        if (!pos) return;
        markerEl.style.position = 'absolute';
        markerEl.style.left = `${pos.x}px`;
        markerEl.style.top = `${pos.y}px`;
      };
      overlay.onRemove = function onRemove() {
        markerEl.remove();
      };
      userMarkerRef.current = { overlay, markerEl, position: center };
      overlay.setMap(googleMapRef.current);
    } else {
      userMarkerRef.current.position = center;
      const { overlay, markerEl } = userMarkerRef.current;
      const projection = overlay.getProjection?.();
      if (projection) {
        const pos = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(center.lat, center.lon));
        if (pos) {
          markerEl.style.left = `${pos.x}px`;
          markerEl.style.top = `${pos.y}px`;
        }
      }
      overlay.setMap(googleMapRef.current);
    }
  };

  const drawFocusMarker = (station: Station) => {
    if (!googleMapRef.current || !window.google?.maps) return;
    const brandKey = detectBrandKey(station.name);
    const svgMarkup = BRAND_SVG_LOGOS[brandKey] || BRAND_SVG_LOGOS.unknown;
    const logoSrc = brandLogoMarkers && svgMarkup ? svgToDataUrl(svgMarkup) : station.image;
    if (focusMarkerRef.current) {
      focusMarkerRef.current.setMap(null);
      focusMarkerRef.current = null;
    }
    const markerEl = document.createElement('div');
    markerEl.style.zIndex = '1000';
    markerEl.innerHTML = `
      <div style="position:relative; transform:translateZ(0);">
        <div style="
          width:72px;
          border-radius:10px;
          overflow:hidden;
          border:2px solid #ffffff;
          background:#efefef;
          box-shadow:0 0 0 2px #111111,0 12px 24px rgba(0,0,0,0.45);
          font-family:'Space Grotesk',sans-serif;
        ">
          <div style="
            background:#111111;
            color:#f5f5f5;
            text-align:center;
            font-size:16px;
            font-weight:800;
            line-height:1;
            padding:7px 4px 8px;
          ">$${station.price.toFixed(2)}</div>
          <div style="background:#f1f1f1;display:flex;align-items:center;justify-content:center;padding:7px 0 9px;">
            <div style="width:43px;height:43px;border-radius:999px;background:#ffffff;border:2px solid #bcbcbc;overflow:hidden;display:flex;align-items:center;justify-content:center;">
              ${
                logoSrc
                  ? `<img src="${logoSrc}" alt="" style="width:100%;height:100%;object-fit:contain;display:block;" />`
                  : `<span style="font-size:10px;color:#4b5563;font-weight:700;">GAS</span>`
              }
            </div>
          </div>
        </div>
        <div style="
          position:absolute; left:50%; transform:translateX(-50%);
          top:100%; margin-top:-1px; width:0; height:0;
          border-left:12px solid transparent;
          border-right:12px solid transparent;
          border-top:14px solid #c8c8c8;
          filter:drop-shadow(0 3px 4px rgba(0,0,0,0.25));
        "></div>
      </div>
    `;
    const overlay = new window.google.maps.OverlayView();
    overlay.onAdd = function onAdd() {
      this.getPanes()?.overlayMouseTarget.appendChild(markerEl);
    };
    overlay.draw = function draw() {
      const projection = this.getProjection();
      if (!projection) return;
      const pos = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(station.lat, station.lon));
      if (!pos) return;
      markerEl.style.position = 'absolute';
      markerEl.style.left = `${pos.x - 36}px`;
      markerEl.style.top = `${pos.y - 84}px`;
    };
    overlay.onRemove = function onRemove() {
      markerEl.remove();
    };
    overlay.setMap(googleMapRef.current);
    focusMarkerRef.current = overlay;
  };

  const scheduleResetToDefaultView = () => {
    if (!detected) return;
    if (focusResetTimerRef.current) window.clearTimeout(focusResetTimerRef.current);
    focusResetTimerRef.current = window.setTimeout(() => {
      fitMapToSearchRadius(detected);
      if (focusMarkerRef.current) {
        focusMarkerRef.current.setMap(null);
        focusMarkerRef.current = null;
      }
    }, 850);
  };

  const drawRadiusRing = (center: { lat: number; lon: number } | null) => {
    if (!center || !googleMapRef.current || !window.google?.maps) return;
    const map = googleMapRef.current;
    const mapCenter = { lat: center.lat, lng: center.lon };

    if (!showRadiusRing) {
      radiusCircleRef.current?.setMap(null);
      radiusCircleRef.current = null;
      return;
    }

    if (!radiusCircleRef.current) {
      radiusCircleRef.current = new window.google.maps.Circle({
        map,
        center: mapCenter,
        radius: Math.max(700, radiusKm * 560),
        strokeColor: '#e5e5e5',
        strokeOpacity: 0.38,
        strokeWeight: 1,
        fillColor: '#ffffff',
        fillOpacity: 0.055,
      });
    }

    radiusCircleRef.current.setMap(map);
    radiusCircleRef.current.setCenter(mapCenter);
    animateCircleRadius(radiusCircleRef.current, radiusKm * 1000);
    drawUserMarker(center);
    fitMapToSearchRadius(center);
  };

  const drawMarkers = (items: Station[]) => {
    if (!googleMapRef.current || !window.google?.maps) return;
    clearMarkers();

    items.forEach((s, index) => {
      const markerEl = document.createElement('div');
      markerEl.className = 'luxefuel-pin';
      const brandKey = detectBrandKey(s.name);
      const svgMarkup = BRAND_SVG_LOGOS[brandKey] || BRAND_SVG_LOGOS.unknown;
      const logoSrc = brandLogoMarkers && svgMarkup ? svgToDataUrl(svgMarkup) : s.image;
      markerEl.innerHTML = `
        <div style="position:relative; transform:translateZ(0);">
          <div style="
            width:72px;
            border-radius:10px;
            overflow:hidden;
            border:1px solid #8f8f8f;
            background:#efefef;
            box-shadow:0 8px 18px rgba(0,0,0,0.3);
            font-family:'Space Grotesk',sans-serif;
          ">
            <div style="
              background:#111111;
              color:#f5f5f5;
              text-align:center;
              font-size:16px;
              font-weight:800;
              line-height:1;
              padding:7px 4px 8px;
              letter-spacing:0.01em;
            ">
              $${s.price.toFixed(2)}
            </div>
            <div style="
              background:#f1f1f1;
              display:flex;
              align-items:center;
              justify-content:center;
              padding:7px 0 9px;
            ">
              <div style="
                width:43px;height:43px;border-radius:999px;
                background:#ffffff;border:2px solid #bcbcbc;
                overflow:hidden;display:flex;align-items:center;justify-content:center;
              ">
                ${
                  logoSrc
                    ? `<img src="${logoSrc}" alt="" style="width:100%;height:100%;object-fit:contain;display:block;" />`
                    : `<span style="font-size:10px;color:#4b5563;font-weight:700;">GAS</span>`
                }
              </div>
            </div>
          </div>
          <div style="
            position:absolute; left:50%; transform:translateX(-50%);
            top:100%; margin-top:-1px; width:0; height:0;
            border-left:12px solid transparent;
            border-right:12px solid transparent;
            border-top:14px solid #c8c8c8;
            filter:drop-shadow(0 3px 4px rgba(0,0,0,0.25));
          "></div>
        </div>
      `;

      const marker = new window.google.maps.OverlayView();
      marker.onAdd = function onAdd() {
        const panes = this.getPanes();
        panes?.overlayMouseTarget.appendChild(markerEl);
        markerElementsRef.current.set(s.id, markerEl);
        markerEl.style.cursor = 'pointer';
        markerEl.addEventListener('mouseenter', () => setHoveredStationId(s.id));
        markerEl.addEventListener('mouseleave', () => setHoveredStationId((current) => (current === s.id ? null : current)));
        markerEl.addEventListener('click', () => {
          window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`, '_blank', 'no-referrer');
        });
        markerEl.animate(
          [
            { opacity: 0, transform: 'translateY(14px) scale(0.82)' },
            { opacity: 1, transform: 'translateY(-4px) scale(1.04)', offset: 0.76 },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ],
          {
            duration: 420,
            delay: Math.min(index * 34, 220),
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            fill: 'both',
          }
        );
      };
      marker.draw = function draw() {
        const projection = this.getProjection();
        if (!projection) return;
        const pos = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(s.lat, s.lon));
        if (!pos) return;
        markerEl.style.position = 'absolute';
        markerEl.style.left = `${pos.x - 36}px`;
        markerEl.style.top = `${pos.y - 84}px`;
      };
      marker.onRemove = function onRemove() {
        markerElementsRef.current.delete(s.id);
        markerEl.remove();
      };
      marker.setMap(googleMapRef.current);
      markersRef.current.push(marker);
    });
  };

  const focusStationOnMap = (station: Station) => {
    if (!googleMapRef.current || !window.google?.maps) return;
    const map = googleMapRef.current;
    map.panTo({ lat: station.lat, lng: station.lon });
    const currentZoom = Number(map.getZoom?.() ?? 12);
    if (currentZoom < 13) map.setZoom(13);
    drawFocusMarker(station);
  };

  const fetchCheapestAroundYou = async (lat: number, lon: number, activeSequence: number) => {
    discoveryControllerRef.current?.abort();
    const controller = new AbortController();
    discoveryControllerRef.current = controller;
    setDiscoveryLoading(true);
    const startedAt = performance.now();
    console.info('[test2] discovery-fetch:start', { lat, lon, radiusKm, fuelType, sequence: activeSequence });

    try {
      const resp = await fetch(
        `/api/cheapest-gas?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}&fuelType=${fuelType}&includeDiscovery=1`,
        { signal: controller.signal }
      );
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Failed to fetch cheapest around you');
      if (controller.signal.aborted || activeSequence !== fetchSequenceRef.current) return;
      setCheapestAroundYou((data.cheapestIn50Km || null) as Station | null);
      setDiscoveryRadiusKm(Number(data.discoveryRadiusKm || 50));
      console.info('[test2] discovery-fetch:success', {
        sequence: activeSequence,
        elapsedMs: Math.round(performance.now() - startedAt),
        backendElapsedMs: data.elapsedMs,
        cheapestPrice: data.cheapestIn50Km?.price ?? null,
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn('[test2] cheapest-around-you:error', err);
      } else {
        console.info('[test2] discovery-fetch:aborted', { sequence: activeSequence });
      }
    } finally {
      if (activeSequence === fetchSequenceRef.current) {
        setDiscoveryLoading(false);
        discoveryControllerRef.current = null;
      }
    }
  };

  const fetchAndRenderStations = async (lat: number, lon: number) => {
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    const sequence = fetchSequenceRef.current + 1;
    fetchSequenceRef.current = sequence;
    fetchControllerRef.current = controller;

    const startedAt = performance.now();
    console.info('[test2] main-fetch:start', { lat, lon, radiusKm, fuelType, sequence });
    try {
      const resp = await fetch(`/api/cheapest-gas?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}&fuelType=${fuelType}&includeDiscovery=0`, {
        signal: controller.signal,
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Failed to fetch stations');
      if (controller.signal.aborted || sequence !== fetchSequenceRef.current) return;

      const top = (data.topResults || []) as Station[];
      console.info('[test2] main-fetch:success', {
        count: top.length,
        scanned: data.scannedStations,
        priced: data.pricedStations,
        elapsedMs: Math.round(performance.now() - startedAt),
        backendElapsedMs: data.elapsedMs,
        sequence,
      });
      setStations(top);
      if (!discoveryRequestedRef.current) {
        discoveryRequestedRef.current = true;
        void fetchCheapestAroundYou(lat, lon, sequence);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.info('[test2] main-fetch:aborted', { sequence });
        return;
      }
      throw err;
    } finally {
      if (sequence === fetchSequenceRef.current) {
        fetchControllerRef.current = null;
      }
    }
  };

  const toLocationFix = (pos: GeolocationPosition, source: LocationFix['source']): LocationFix => ({
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : undefined,
    detectedAt: new Date(pos.timestamp || Date.now()).toISOString(),
    source,
  });

  const readCachedLocation = (): LocationFix | null => {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCATION_CACHE_KEY) || 'null');
      if (!Number.isFinite(parsed?.lat) || !Number.isFinite(parsed?.lon)) return null;
      const detectedAt = parsed.detectedAt || parsed.grantedAt;
      const age = detectedAt ? Date.now() - new Date(detectedAt).getTime() : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(age) || age > LOCATION_CACHE_MAX_AGE_MS) return null;
      return {
        lat: parsed.lat,
        lon: parsed.lon,
        accuracy: Number.isFinite(parsed.accuracy) ? parsed.accuracy : undefined,
        detectedAt: new Date(detectedAt).toISOString(),
        source: 'cache',
      };
    } catch {
      return null;
    }
  };

  const saveLocation = (fix: LocationFix) => {
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(fix));
  };

  const getQuickPosition = () =>
    new Promise<LocationFix>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(toLocationFix(pos, 'quick')),
        reject,
        { enableHighAccuracy: false, timeout: 2800, maximumAge: 30000 }
      );
    });

  const getPrecisePosition = () =>
    new Promise<LocationFix>((resolve, reject) => {
      let best: LocationFix | null = null;
      let settled = false;
      let watchId: number | null = null;

      const cleanup = () => {
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        window.clearTimeout(timer);
      };

      const finish = (fix: LocationFix | null, err?: GeolocationPositionError) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (fix) resolve(fix);
        else reject(err || new Error('Unable to get a precise location.'));
      };

      const timer = window.setTimeout(() => finish(best), 7200);

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const fix = toLocationFix(pos, 'precise');
          if (!best || (fix.accuracy ?? Number.POSITIVE_INFINITY) < (best.accuracy ?? Number.POSITIVE_INFINITY)) {
            best = fix;
            console.info('[test2] geolocation:precision-sample', {
              lat: fix.lat,
              lon: fix.lon,
              accuracy: fix.accuracy,
            });
          }
          if ((fix.accuracy ?? Number.POSITIVE_INFINITY) <= 35) finish(fix);
        },
        (err) => finish(best, err),
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
      );
    });

  const applyLocationFix = async (fix: LocationFix, options: { fetchStations?: boolean } = {}) => {
    console.info('[test2] geolocation:apply-fix', {
      lat: fix.lat,
      lon: fix.lon,
      accuracy: fix.accuracy,
      source: fix.source,
    });
    setDetected(fix);
    saveLocation(fix);
    googleMapRef.current?.setCenter({ lat: fix.lat, lng: fix.lon });
    drawRadiusRing(fix);
    if (options.fetchStations !== false) {
      await fetchAndRenderStations(fix.lat, fix.lon);
    }
  };

  const locateAndLoad = (silent = false) => {
    const locationSequence = locationSequenceRef.current + 1;
    locationSequenceRef.current = locationSequence;
    console.info('[test2] locateAndLoad:start', { silent, locationSequence });
    if (!navigator.geolocation) {
      console.error('[test2] locateAndLoad:no-geolocation');
      if (!silent) setError('Geolocation is not supported by your browser.');
      setLoading(false);
      return;
    }

    const run = async () => {
      let hasUsableFix = false;
      const cached = readCachedLocation();
      if (cached) {
        hasUsableFix = true;
        await applyLocationFix(cached);
        setLoading(false);
      }

      try {
        const quick = await getQuickPosition();
        if (locationSequence !== locationSequenceRef.current) return;
        hasUsableFix = true;
      await applyLocationFix(quick);
      setLoading(false);
      } catch (quickError) {
        console.warn('[test2] geolocation:quick-failed', quickError);
      }

      // Keep camera stable: skip late precision recentering/refetch.
    };

    void run()
      .catch((e: any) => {
        console.error('[test2] geolocation:failed', e);
        if (!silent) setError('Unable to get your location. Check browser location permission and device accuracy settings.');
      })
      .finally(() => setLoading(false));
  };

  const initAndSearch = async () => {
    try {
      console.info('[test2] initAndSearch:start');
      setLoading(true);
      setError(null);
      await loadGoogleMaps();

      if (!mapRef.current) {
        console.warn('[test2] initAndSearch:map-not-mounted-yet');
        return;
      }
      googleMapRef.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: 49.2827, lng: -123.1207 },
        zoom: 12,
        styles: MAP_STYLE as any,
        disableDefaultUI: true,
      });
      console.info('[test2] initAndSearch:map-created');
      setStage('map');
      locateAndLoad(true);
    } catch (err: any) {
      console.error('[test2] initAndSearch:error', err);
      setError(err?.message || 'Failed to load map');
      setStage('map');
      setLoading(false);
    }
  };

  useEffect(() => {
    const revealTimer = window.setTimeout(() => setStage('map'), 1400);
    return () => window.clearTimeout(revealTimer);
  }, []);

  useEffect(() => {
    if (stage !== 'map') return;
    if (!mapMounted) return;
    if (googleMapRef.current) return;
    void initAndSearch();
    return () => {
      clearMarkers();
      userMarkerRef.current?.overlay?.setMap?.(null);
      focusMarkerRef.current?.setMap?.(null);
      radiusCircleRef.current?.setMap(null);
      if (radiusAnimationRef.current) window.cancelAnimationFrame(radiusAnimationRef.current);
      if (focusResetTimerRef.current) window.clearTimeout(focusResetTimerRef.current);
      fetchControllerRef.current?.abort();
      discoveryControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, mapMounted]);

  const sortedStations = useMemo(() => {
    const uniqueById = Array.from(
      stations.reduce((acc, station) => {
        if (!acc.has(station.id)) acc.set(station.id, station);
        return acc;
      }, new Map<string, Station>()).values()
    );

    const sorted = [...uniqueById].sort((a, b) => {
      if (sortMode === 'distance') return (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);
      return a.price - b.price;
    });
    return sorted;
  }, [sortMode, stations]);

  const visibleStations = useMemo(() => {
    return sortedStations.slice(0, 10);
  }, [sortedStations]);

  useEffect(() => {
    markerElementsRef.current.forEach((el, id) => {
      if (hoveredStationId === id) {
        el.style.zIndex = '999';
        el.style.filter = 'drop-shadow(0 0 14px rgba(255,255,255,0.45))';
        el.style.transform = 'scale(1.08)';
      } else {
        el.style.zIndex = '1';
        el.style.filter = 'none';
        el.style.transform = 'scale(1)';
      }
    });
  }, [hoveredStationId]);

  useEffect(() => {
    if (hoveredStationId) {
      if (focusResetTimerRef.current) {
        window.clearTimeout(focusResetTimerRef.current);
        focusResetTimerRef.current = null;
      }
      return;
    }
    // When sidebar hover/focus ends, always restore current radius camera.
    scheduleResetToDefaultView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredStationId, detected, radiusKm]);

  useEffect(() => {
    if (!detected || !googleMapRef.current) return;
    drawRadiusRing(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, radiusKm, showRadiusRing]);

  useEffect(() => {
    if (!detected || !googleMapRef.current) return;
    setRefreshing(true);
    setError(null);
    void fetchAndRenderStations(detected.lat, detected.lon)
      .catch((err) => {
        console.error('[test2] filter-refetch:error', err);
        setError(err?.message || 'Failed to refresh stations');
      })
      .finally(() => setRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm, fuelType]);

  useEffect(() => {
    if (!googleMapRef.current) return;
    drawMarkers(visibleStations);
    if (detected) drawUserMarker(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleStations, brandLogoMarkers]);


  return (
    <div className="min-h-screen bg-luxury-black text-luxury-white">
      <AnimatePresence mode="wait">
        {stage === 'intro' ? (
          <motion.main
            key="intro"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="min-h-screen flex items-center justify-center px-6"
          >
            <div className="text-center">
              <motion.h1
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="font-display text-6xl md:text-8xl font-bold uppercase tracking-tight leading-[0.92]"
              >
                Find Cheap
                <span className="block italic font-light opacity-70">Gas</span>
              </motion.h1>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.65 }}
                transition={{ delay: 0.25 }}
                className="mt-8 inline-flex items-center gap-3 text-[10px] uppercase tracking-[0.28em]"
              >
                <Loader2 className="animate-spin" size={14} />
                Loading live map
              </motion.div>
            </div>
          </motion.main>
        ) : (
          <motion.main
            key="map"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="max-w-[1500px] mx-auto px-3 md:px-6 py-5 md:py-8 min-h-screen"
          >
            <motion.div
              initial={{ y: 40, opacity: 0, scale: 1.02 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ duration: 0.55 }}
              className="text-center mb-6 md:mb-8"
            >
              <h1 className="font-display text-3xl md:text-6xl font-bold uppercase tracking-tight leading-[0.95]">
                Find Cheap <span className="italic font-light opacity-70">Gas</span>
              </h1>
              <p className="text-[9px] md:text-[10px] uppercase tracking-[0.2em] opacity-50 mt-2">
                Live Map View · Monochrome Luxury
              </p>
            </motion.div>

            <motion.section
              initial={{ y: 90, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.65, delay: 0.08 }}
              className="rounded-3xl border border-white/10 bg-luxury-gray-900 overflow-hidden relative min-h-[760px] md:min-h-[860px] lg:h-[78vh] lg:min-h-[650px] lg:grid lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]"
            >
              <div className="relative min-h-[500px] md:min-h-[620px] lg:h-full">
              <div className="absolute inset-x-0 top-0 z-20 p-3 md:p-4 pointer-events-none">
                <motion.div
                  animate={{
                    scale: refreshing ? 0.992 : 1,
                    borderColor: refreshing ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.12)',
                  }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                  className="rounded-2xl border border-white/12 bg-black/45 backdrop-blur-md px-3 md:px-4 py-2.5 md:py-3 w-[min(94vw,430px)] pointer-events-auto shadow-2xl shadow-black/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[9px] md:text-[10px] uppercase tracking-[0.2em] opacity-60">Detected Location</p>
                      <p className="text-xs md:text-sm mt-1 opacity-85">
                        {detected ? `${detected.lat.toFixed(5)}, ${detected.lon.toFixed(5)}` : 'Awaiting permission...'}
                      </p>
                      {detected?.accuracy && (
                        <p className="text-[9px] md:text-[10px] uppercase tracking-[0.15em] opacity-45 mt-1">
                          Accuracy {detected.accuracy}m · {detected.source}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <motion.p
                        key={radiusKm}
                        initial={{ opacity: 0, y: 8, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.26, ease: 'easeOut' }}
                        className="font-display text-xl md:text-2xl font-bold leading-none"
                      >
                        {radiusKm}
                      </motion.p>
                      <p className="text-[8px] md:text-[9px] uppercase tracking-[0.16em] opacity-45">km radius</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <input
                      type="range"
                      min="5"
                      max="25"
                      step="5"
                      value={radiusKm}
                      onChange={(event) => setRadiusKm(Number(event.target.value))}
                      className="w-full accent-white"
                      aria-label="Search radius in kilometers"
                    />
                    <div className="mt-1 flex justify-between text-[8px] md:text-[9px] uppercase tracking-[0.14em] opacity-45">
                      <span>5</span>
                      <span>10</span>
                      <span>15</span>
                      <span>20</span>
                      <span>25</span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {FUEL_CHOICES.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        onClick={() => setFuelType(choice.value)}
                        className={`rounded-full border px-2 py-1.5 text-[8px] md:text-[9px] uppercase tracking-[0.1em] transition-all duration-200 hover:-translate-y-0.5 ${
                          fuelType === choice.value
                            ? 'border-white bg-white text-black'
                            : 'border-white/15 bg-white/5 text-white/65 hover:border-white/35'
                        }`}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/12 bg-white/5 px-2 py-2">
                      <p className="text-[8px] md:text-[9px] uppercase tracking-[0.14em] opacity-45 px-1">Sort</p>
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => setSortMode('price')}
                          className={`rounded-md border px-2 py-1 text-[9px] md:text-[10px] uppercase tracking-[0.1em] transition-all duration-200 ${
                            sortMode === 'price'
                              ? 'border-white bg-white text-black'
                              : 'border-white/15 bg-white/0 text-white/75 hover:border-white/35'
                          }`}
                        >
                          Cheapest
                        </button>
                        <button
                          type="button"
                          onClick={() => setSortMode('distance')}
                          className={`rounded-md border px-2 py-1 text-[9px] md:text-[10px] uppercase tracking-[0.1em] transition-all duration-200 ${
                            sortMode === 'distance'
                              ? 'border-white bg-white text-black'
                              : 'border-white/15 bg-white/0 text-white/75 hover:border-white/35'
                          }`}
                        >
                          Nearest
                        </button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/12 bg-white/5 px-2 py-2">
                      <p className="text-[8px] md:text-[9px] uppercase tracking-[0.14em] opacity-45 px-1">Cards</p>
                      <div className="mt-2">
                        <div className="rounded-md border border-white bg-white text-black px-2 py-1 text-[9px] md:text-[10px] uppercase tracking-[0.1em] font-bold text-center">
                          Top 10
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowRadiusRing((current) => !current)}
                      className={`rounded-xl border px-3 py-2 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                        showRadiusRing ? 'border-white/35 bg-white/10' : 'border-white/12 bg-white/5'
                      }`}
                    >
                      <p className="text-[8px] md:text-[9px] uppercase tracking-[0.14em] opacity-45">Radius Ring</p>
                      <p className="text-[11px] md:text-xs font-bold uppercase">{showRadiusRing ? 'On' : 'Off'}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBrandLogoMarkers((current) => !current)}
                      className={`rounded-xl border px-3 py-2 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                        brandLogoMarkers ? 'border-white/35 bg-white/10' : 'border-white/12 bg-white/5'
                      }`}
                    >
                      <p className="text-[8px] md:text-[9px] uppercase tracking-[0.14em] opacity-45">Marker Logos</p>
                      <p className="text-[11px] md:text-xs font-bold uppercase">{brandLogoMarkers ? 'Brand' : 'Photo'}</p>
                    </button>
                  </div>

                  {!detected && (
                    <button
                      type="button"
                      onClick={() => {
                        setLoading(true);
                        setError(null);
                        locateAndLoad(false);
                      }}
                      className="mt-2 rounded-full border border-white/25 px-3 py-1 text-[9px] md:text-[10px] uppercase tracking-[0.16em] font-bold opacity-80 hover:opacity-100"
                    >
                      Use My Location
                    </button>
                  )}
                </motion.div>
              </div>

              <AnimatePresence>
                {refreshing && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-3 top-3 md:right-4 md:top-4 z-30 rounded-full border border-white/15 bg-black/55 backdrop-blur-md px-3 py-2 text-[10px] uppercase tracking-[0.18em] shadow-xl"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="animate-spin" size={12} />
                      Updating map
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {refreshing && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
                  >
                    <motion.div
                      initial={{ x: '-45%' }}
                      animate={{ x: '120%' }}
                      transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
                      className="h-full w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent blur-xl"
                    />
                  </motion.div>
                )}
              </AnimatePresence>


              <div
                ref={(el) => {
                  mapRef.current = el;
                  setMapMounted(Boolean(el));
                }}
                className="absolute inset-0"
              />
              {loading && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                  <Loader2 className="animate-spin" size={42} />
                </div>
              )}
              {error && (
                <div className="absolute inset-x-4 top-4 rounded-2xl border border-white/15 bg-black/65 px-4 py-3 text-sm">
                  {error}
                </div>
              )}
              </div>

              <aside className="relative border-t lg:border-t-0 lg:border-l border-white/10 bg-black/45 backdrop-blur-xl p-2.5 md:p-4 flex flex-col max-h-[42vh] lg:max-h-none rounded-t-2xl lg:rounded-none">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Fuel size={13} />
                      <p className="text-[9px] md:text-[10px] uppercase tracking-[0.2em] opacity-60">Cheapest Nearby</p>
                    </div>
                    <h2 className="font-display text-lg md:text-xl font-bold uppercase mt-1.5 md:mt-2 leading-none">Live Finds</h2>
                  </div>
                  <div className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[8px] md:text-[10px] uppercase tracking-[0.14em] opacity-70">
                    Top 10 shown
                  </div>
                </div>
                <p className="mt-2 text-[9px] md:text-[10px] uppercase tracking-[0.12em] opacity-40">
                  API parses gas stations from your location up to {discoveryRadiusKm} km and ranks by price per liter.
                </p>
                <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
                  {cheapestAroundYou && !discoveryLoading ? (
                    <button
                      type="button"
                      onClick={() => focusStationOnMap(cheapestAroundYou)}
                      className="w-full text-left text-[9px] md:text-[10px] uppercase tracking-[0.12em] opacity-75 hover:opacity-100 transition-opacity"
                    >
                      {`Cheapest around you: ${cheapestAroundYou.name} at $${cheapestAroundYou.price.toFixed(2)}${typeof cheapestAroundYou.distanceKm === 'number' ? ` · ${cheapestAroundYou.distanceKm.toFixed(1)} km away` : ''}`}
                    </button>
                  ) : (
                    <p className="text-[9px] md:text-[10px] uppercase tracking-[0.12em] opacity-65">
                      {discoveryLoading
                        ? `Background scan in progress: parsing up to ${discoveryRadiusKm} km for the cheapest station...`
                        : `Parsing up to ${discoveryRadiusKm} km to find the cheapest gas station around you...`}
                    </p>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-1">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">
                    <p className="text-[8px] md:text-[9px] uppercase tracking-[0.14em] opacity-45">Radius</p>
                    <p className="font-display text-sm md:text-base font-bold">{radiusKm} km</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">
                    <p className="text-[8px] md:text-[9px] uppercase tracking-[0.14em] opacity-45">Sort</p>
                    <p className="font-display text-sm md:text-base font-bold">{sortMode === 'price' ? 'Price' : 'Near'}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2">
                    <p className="text-[8px] md:text-[9px] uppercase tracking-[0.14em] opacity-45">Fuel</p>
                    <p className="font-display text-sm md:text-base font-bold">{fuelType === 'REGULAR_UNLEADED' ? 'Reg' : fuelType === 'MIDGRADE' ? 'Mid' : fuelType === 'PREMIUM' ? 'Prem' : 'Diesel'}</p>
                  </div>
                </div>

                <AnimatePresence>
                  {refreshing && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.045] p-3">
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] opacity-65">
                          <Loader2 className="animate-spin" size={12} />
                          Searching full radius
                        </div>
                        <div className="mt-3 space-y-2">
                          {[0, 1, 2].map((i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0.35 }}
                              animate={{ opacity: [0.35, 0.75, 0.35] }}
                              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.12 }}
                              className="h-2 rounded-full bg-white/15"
                              style={{ width: `${86 - i * 16}%` }}
                            />
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="mt-3 flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-1.5 md:space-y-2">
                  <AnimatePresence mode="popLayout">
                    {visibleStations.map((s, index) => (
                      <motion.button
                        key={s.id}
                        layout
                        initial={{ opacity: 0, x: 22, scale: 0.96 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 14, scale: 0.96 }}
                        transition={{ duration: 0.24, delay: Math.min(index * 0.025, 0.14) }}
                        onMouseEnter={() => {
                          setHoveredStationId(s.id);
                          focusStationOnMap(s);
                        }}
                        onMouseLeave={() => setHoveredStationId((current) => (current === s.id ? null : current))}
                        onFocus={() => {
                          setHoveredStationId(s.id);
                          focusStationOnMap(s);
                        }}
                        onBlur={() => setHoveredStationId((current) => (current === s.id ? null : current))}
                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`, '_blank', 'no-referrer')}
                        className="group w-full text-left rounded-xl border border-white/10 bg-white/[0.045] px-2.5 md:px-3 py-2 md:py-2.5 hover:border-white/30 hover:bg-white/[0.075] hover:-translate-y-0.5 transition-all duration-200"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-[11px] md:text-xs uppercase truncate">{s.name}</p>
                            <p className="text-[10px] md:text-[11px] opacity-50 mt-1 truncate">{s.address}</p>
                          </div>
                          <span className="font-display text-base md:text-lg font-bold leading-none">${s.price.toFixed(2)}</span>
                        </div>
                        <div className="mt-2.5 md:mt-3 flex items-center justify-between gap-3 text-[9px] md:text-[10px] uppercase tracking-[0.12em] opacity-45">
                          <span>{typeof s.distanceKm === 'number' ? `${s.distanceKm.toFixed(1)} km away` : 'Distance unavailable'}</span>
                          <span className="truncate">{s.fuelType || fuelType}</span>
                        </div>
                        <AnimatePresence>
                          {hoveredStationId === s.id && (
                            <motion.div
                              initial={{ opacity: 0, y: -4, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: 'auto' }}
                              exit={{ opacity: 0, y: -4, height: 0 }}
                              transition={{ duration: 0.18 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[10px] uppercase tracking-[0.16em] opacity-55">
                                    {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">
                                    <Navigation size={11} />
                                    Directions
                                  </span>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </div>
              </aside>
            </motion.section>

            <div className="mt-5 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] opacity-45">
              <MapPin size={11} />
              Heading transitions to top while live map rises into center.
            </div>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}


