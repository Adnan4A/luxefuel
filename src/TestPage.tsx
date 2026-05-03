import { useEffect, useState } from 'react';
import { Fuel, Loader2, MapPin, Navigation } from 'lucide-react';

type CheapestResult = {
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

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const METRO_VANCOUVER_TOP5 = [
  {
    name: 'Vancouver',
    lat: 49.2827,
    lon: -123.1207,
    bbox: { minLat: 49.1985, minLon: -123.2247, maxLat: 49.3165, maxLon: -123.0230 },
  },
  {
    name: 'Surrey',
    lat: 49.1913,
    lon: -122.8490,
    bbox: { minLat: 49.0024, minLon: -122.9060, maxLat: 49.2198, maxLon: -122.6811 },
  },
  {
    name: 'Burnaby',
    lat: 49.2488,
    lon: -122.9805,
    bbox: { minLat: 49.1989, minLon: -123.0243, maxLat: 49.2885, maxLon: -122.8925 },
  },
  {
    name: 'Richmond',
    lat: 49.1666,
    lon: -123.1336,
    bbox: { minLat: 49.0841, minLon: -123.2280, maxLat: 49.2037, maxLon: -123.0600 },
  },
  {
    name: 'Coquitlam',
    lat: 49.2838,
    lon: -122.7932,
    bbox: { minLat: 49.2272, minLon: -122.9114, maxLat: 49.3615, maxLon: -122.6880 },
  },
  {
    name: 'Langley',
    lat: 49.1044,
    lon: -122.6604,
    bbox: { minLat: 49.0600, minLon: -122.7360, maxLat: 49.1460, maxLon: -122.5550 },
  },
  {
    name: 'Cloverdale',
    lat: 49.1044,
    lon: -122.7300,
    bbox: { minLat: 49.0300, minLon: -122.8200, maxLat: 49.1550, maxLon: -122.6500 },
  },
  {
    name: 'Abbotsford',
    lat: 49.0504,
    lon: -122.3045,
    bbox: { minLat: 49.0000, minLon: -122.4300, maxLat: 49.1400, maxLon: -122.1700 },
  },
] as const;

export default function TestPage() {
  const [fuelType, setFuelType] = useState('REGULAR_UNLEADED');
  const [radiusKm, setRadiusKm] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const [modeLabel, setModeLabel] = useState<'Current Location' | 'Address Search' | 'Metro Municipality'>('Current Location');
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [recentHistory, setRecentHistory] = useState<Array<{ label: string; at: string }>>([]);
  const [detectedLocation, setDetectedLocation] = useState<{ lat: number; lon: number; accuracyM?: number; grantedAt: string } | null>(null);
  const [searchCenter, setSearchCenter] = useState<{ lat: number; lon: number; source: string } | null>(null);
  const [result, setResult] = useState<{
    scannedStations: number;
    pricedStations: number;
    cheapest: CheapestResult | null;
    topResults: CheapestResult[];
  } | null>(null);

  useEffect(() => {
    try {
      const cachedFuelType = localStorage.getItem('test_fuel_type');
      const cachedRadius = localStorage.getItem('test_radius_km');
      const cachedAddress = localStorage.getItem('test_address_input');
      const cachedHistory = localStorage.getItem('test_recent_history');
      const cachedDetected = localStorage.getItem('test_detected_location');
      if (cachedFuelType) setFuelType(cachedFuelType);
      if (cachedRadius && Number.isFinite(Number(cachedRadius))) setRadiusKm(Number(cachedRadius));
      if (cachedAddress) setAddressInput(cachedAddress);
      if (cachedHistory) setRecentHistory(JSON.parse(cachedHistory));
      if (cachedDetected) setDetectedLocation(JSON.parse(cachedDetected));
    } catch {}
  }, []);

  const detectUserLocation = (silently = false) => {
    if (!navigator.geolocation) {
      if (!silently) setError('Geolocation is not supported in this browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const detected = { lat, lon, accuracyM: pos.coords.accuracy, grantedAt: new Date().toISOString() };
        localStorage.setItem('test_detected_location', JSON.stringify(detected));
        setDetectedLocation(detected);
      },
      () => {
        if (!silently) setError('Unable to detect your location.');
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
    );
  };

  useEffect(() => {
    const hasCached = !!localStorage.getItem('test_detected_location');
    if (!hasCached) detectUserLocation(true);
  }, []);

  useEffect(() => {
    localStorage.setItem('test_fuel_type', fuelType);
    localStorage.setItem('test_radius_km', String(radiusKm));
    localStorage.setItem('test_address_input', addressInput);
  }, [fuelType, radiusKm, addressInput]);

  const addHistory = (label: string) => {
    const next = [{ label, at: new Date().toISOString() }, ...recentHistory].slice(0, 8);
    setRecentHistory(next);
    localStorage.setItem('test_recent_history', JSON.stringify(next));
  };

  const runSearch = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const detected = { lat, lon, accuracyM: pos.coords.accuracy, grantedAt: new Date().toISOString() };
        localStorage.setItem('test_detected_location', JSON.stringify(detected));
        setDetectedLocation(detected);
        setSearchCenter({ lat, lon, source: 'Current Location (GPS)' });
        setModeLabel('Current Location');
        const resp = await fetch(`/api/cheapest-gas?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}&fuelType=${encodeURIComponent(fuelType)}`);
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || 'Search failed');
        setResult({
          scannedStations: data.scannedStations || 0,
          pricedStations: data.pricedStations || 0,
          cheapest: data.cheapest || null,
          topResults: data.topResults || [],
        });
        addHistory(`Method #1 · Current Location · ${fuelType} · ${radiusKm}km`);
      } catch (err: any) {
        setError(err?.message || 'Failed to run search');
      } finally {
        setLoading(false);
      }
    }, () => {
      setLoading(false);
      setError('Unable to read your current location.');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  };

  const runAddressSearch = async () => {
    const query = addressInput.trim();
    if (!query) {
      setError('Please enter an address.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const geoResp = await fetch(`/api/geocode-address?address=${encodeURIComponent(query)}`);
      const geo = await geoResp.json();
      if (!geoResp.ok || geo.error || geo.lat == null || geo.lon == null) {
        throw new Error(geo.error || 'Could not geocode address');
      }

      setModeLabel('Address Search');
      const resp = await fetch(`/api/cheapest-gas?lat=${geo.lat}&lon=${geo.lon}&radiusKm=${radiusKm}&fuelType=${encodeURIComponent(fuelType)}`);
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Search failed');
      setSearchCenter({ lat: Number(geo.lat), lon: Number(geo.lon), source: `Address: ${geo.address || query}` });
      setResult({
        scannedStations: data.scannedStations || 0,
        pricedStations: data.pricedStations || 0,
        cheapest: data.cheapest || null,
        topResults: data.topResults || [],
      });
      addHistory(`Method #2 · ${query} · ${fuelType} · ${radiusKm}km`);
    } catch (err: any) {
      setError(err?.message || 'Failed to run address search');
    } finally {
      setLoading(false);
    }
  };

  const runMunicipalitySearch = async (city: (typeof METRO_VANCOUVER_TOP5)[number]) => {
    setLoading(true);
    setError(null);
    setActiveCity(city.name);
    try {
      setModeLabel('Metro Municipality');
      setSearchCenter({ lat: city.lat, lon: city.lon, source: `Municipality center: ${city.name}` });
      const resp = await fetch(
        `/api/cheapest-gas?lat=${city.lat}&lon=${city.lon}&radiusKm=${radiusKm}&fuelType=${encodeURIComponent(fuelType)}&bbox=${encodeURIComponent(
          `${city.bbox.minLat},${city.bbox.minLon},${city.bbox.maxLat},${city.bbox.maxLon}`
        )}`
      );
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Search failed');
      setResult({
        scannedStations: data.scannedStations || 0,
        pricedStations: data.pricedStations || 0,
        cheapest: data.cheapest || null,
        topResults: data.topResults || [],
      });
      addHistory(`Method #3 · ${city.name} · ${fuelType} · ${radiusKm}km`);
    } catch (err: any) {
      setError(err?.message || 'Failed to run municipality search');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-luxury-black text-luxury-white">
      <main className="max-w-6xl mx-auto px-6 py-14">
        <div className="flex items-center gap-2 mb-10">
          <Fuel size={20} />
          <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight uppercase">Cheapest Fuel Test</h1>
        </div>

        <div className="rounded-3xl border border-white/10 p-6 md:p-8 bg-luxury-gray-900">
          <p className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-3">Location Diagnostics</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="rounded-2xl border border-white/10 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] opacity-60 mb-1">Detected User Location</p>
              {detectedLocation ? (
                <>
                  <p className="text-sm opacity-80">{detectedLocation.lat.toFixed(5)}, {detectedLocation.lon.toFixed(5)}</p>
                  <p className="text-xs opacity-55 mt-1">Accuracy: {Math.round(detectedLocation.accuracyM || 0)}m</p>
                </>
              ) : (
                <p className="text-sm opacity-55">Not detected yet.</p>
              )}
              <button
                type="button"
                onClick={() => detectUserLocation(false)}
                className="mt-3 rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.2em] opacity-80 hover:opacity-100"
              >
                Detect now
              </button>
            </div>
            <div className="rounded-2xl border border-white/10 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] opacity-60 mb-1">Active Search Center (KM Basis)</p>
              {searchCenter ? (
                <>
                  <p className="text-sm opacity-80">{searchCenter.lat.toFixed(5)}, {searchCenter.lon.toFixed(5)}</p>
                  <p className="text-xs opacity-55 mt-1">{searchCenter.source}</p>
                </>
              ) : (
                <p className="text-sm opacity-55">No search run yet</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="text-sm uppercase tracking-[0.2em] opacity-70">
              Fuel Type
              <select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                className="mt-2 w-full rounded-xl bg-black/30 border border-white/15 px-4 py-3 outline-none"
              >
                <option value="REGULAR_UNLEADED">Regular Unleaded</option>
                <option value="MIDGRADE">Midgrade</option>
                <option value="PREMIUM">Premium</option>
                <option value="DIESEL">Diesel</option>
              </select>
            </label>

            <label className="text-sm uppercase tracking-[0.2em] opacity-70">
              Radius ({radiusKm} km)
              <input
                type="range"
                min={15}
                max={20}
                step={1}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                className="mt-4 w-full"
              />
            </label>

            <div className="flex items-end">
              <button
                onClick={runSearch}
                disabled={loading}
                className="w-full rounded-xl border border-white/20 px-5 py-3 uppercase tracking-[0.2em] text-sm font-bold hover:bg-white hover:text-black transition-colors disabled:opacity-50"
              >
                {loading ? 'Searching...' : 'Run 15-20km Search'}
              </button>
            </div>
          </div>
          {error && <p className="mt-4 text-sm opacity-70">{error}</p>}
          {recentHistory.length > 0 && (
            <div className="mt-5">
              <p className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-2">Search History</p>
              <div className="space-y-1">
                {recentHistory.slice(0, 5).map((h, idx) => (
                  <p key={`${h.at}-${idx}`} className="text-xs opacity-55 truncate">{h.label}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 p-6 md:p-8 bg-luxury-gray-900 mt-6">
          <p className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-3">Testing #2 Method</p>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <input
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Enter address (e.g., 9079 141a st surrey bc)"
              className="w-full rounded-xl bg-black/30 border border-white/15 px-4 py-3 outline-none text-sm"
            />
            <button
              onClick={runAddressSearch}
              disabled={loading}
              className="rounded-xl border border-white/20 px-5 py-3 uppercase tracking-[0.2em] text-sm font-bold hover:bg-white hover:text-black transition-colors disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search by Address'}
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 p-6 md:p-8 bg-luxury-gray-900 mt-6">
          <p className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-3">Testing #3 Method · Metro Vancouver Top 5</p>
          <div className="flex flex-wrap gap-2">
            {METRO_VANCOUVER_TOP5.map((city) => (
              <button
                key={city.name}
                onClick={() => { void runMunicipalitySearch(city); }}
                disabled={loading}
                className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.2em] font-bold transition-colors disabled:opacity-50 ${
                  activeCity === city.name
                    ? 'border-white bg-white text-black'
                    : 'border-white/25 hover:border-white/60'
                }`}
              >
                {city.name}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs opacity-55">
            Uses city-center coordinates and your selected {radiusKm}km radius, then runs the same cheapest-fuel algorithm.
          </p>
        </div>

        {loading && (
          <div className="py-16 flex items-center justify-center">
            <Loader2 className="animate-spin" size={40} />
          </div>
        )}

        {result && !loading && (
          <section className="mt-10 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm uppercase tracking-[0.2em] opacity-70">
              <div className="rounded-2xl border border-white/10 p-4">Mode: {modeLabel}</div>
              <div className="rounded-2xl border border-white/10 p-4">City: {activeCity || 'N/A'}</div>
              <div className="rounded-2xl border border-white/10 p-4">Scanned: {result.scannedStations}</div>
              <div className="rounded-2xl border border-white/10 p-4">Priced: {result.pricedStations}</div>
              <div className="rounded-2xl border border-white/10 p-4">Fuel: {fuelType.replaceAll('_', ' ')}</div>
            </div>

            {result.cheapest && (
              <article className="rounded-3xl border border-white/15 p-6 bg-luxury-gray-900">
                <p className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-2">Cheapest Result</p>
                <h2 className="font-display text-3xl uppercase font-bold">{result.cheapest.name}</h2>
                <p className="opacity-60 mt-1">{result.cheapest.address}</p>
                {detectedLocation && (
                  <p className="opacity-70 mt-1 text-sm">
                    {haversineKm(detectedLocation.lat, detectedLocation.lon, result.cheapest.lat, result.cheapest.lon).toFixed(1)} km from your detected location
                  </p>
                )}
                <div className="mt-4 text-5xl font-display font-bold">
                  ${result.cheapest.price.toFixed(2)} {result.cheapest.currencyCode}
                </div>
              </article>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {result.topResults.map((station) => (
                <div key={station.id} className="rounded-2xl border border-white/10 p-5 bg-luxury-gray-900">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h3 className="font-display text-xl font-bold uppercase">{station.name}</h3>
                      <p className="opacity-60 text-sm mt-1">{station.address}</p>
                      {detectedLocation && (
                        <p className="opacity-65 text-xs mt-1">
                          {haversineKm(detectedLocation.lat, detectedLocation.lon, station.lat, station.lon).toFixed(1)} km from your detected location
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-display font-bold">${station.price.toFixed(2)}</div>
                      <div className="text-[10px] opacity-60 uppercase tracking-[0.15em]">{station.currencyCode}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <MapPin size={14} className="opacity-60" />
                    <button
                      onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}`, '_blank', 'no-referrer')}
                      className="text-sm opacity-80 hover:opacity-100 inline-flex items-center gap-2"
                    >
                      Navigate <Navigation size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
