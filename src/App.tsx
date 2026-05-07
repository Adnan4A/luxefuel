/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Fuel, MapPin, Navigation, Sun, Moon, ArrowRight, Loader2, ChevronDown } from 'lucide-react';
import { useLocation } from './services/locationService';
import { fetchGasStations, GasStation } from './services/gasService';
import { buildGeocodeAddressUrl, resolveManualLocationQuery } from './services/manualLocation';

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const { coords, address, loading: locLoading, error: locError, requestLocation } = useLocation();
  const [stations, setStations] = useState<GasStation[]>([]);
  const [fetchingStations, setFetchingStations] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const [expandedPrices, setExpandedPrices] = useState<Record<string, boolean>>({});
  const [locationInput, setLocationInput] = useState('');
  const [manualAddress, setManualAddress] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [isEditingOrigin, setIsEditingOrigin] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ place: string; text: string }>>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  const loadStations = async (lat: number, lon: number) => {
    setFetchingStations(true);
    const data = await fetchGasStations(lat, lon);
    setStations(data);
    setFetchingStations(false);
  };

  useEffect(() => {
    if (coords) {
      loadStations(coords.latitude, coords.longitude);
    }
  }, [coords]);

  useEffect(() => {
    const current = manualAddress || address;
    if (current) setLocationInput(current);
  }, [address, manualAddress]);

  const handleManualLocationSubmit = async (overrideQuery?: string) => {
    const query = resolveManualLocationQuery(locationInput, overrideQuery);
    if (!query) return;

    setManualError(null);
    setFetchingStations(true);
    try {
      const resp = await fetch(buildGeocodeAddressUrl(query));
      const data = await resp.json();
      if (!resp.ok || data.error || data.lat == null || data.lon == null) {
        throw new Error(data.error || 'Unable to find that location');
      }
      setManualAddress(data.address || query);
      const stationsData = await fetchGasStations(Number(data.lat), Number(data.lon));
      setStations(stationsData);
      setIsEditingOrigin(false);
    } catch (err: any) {
      setManualError(err?.message || 'Unable to update location');
    } finally {
      setFetchingStations(false);
    }
  };

  useEffect(() => {
    if (!isEditingOrigin) {
      setSuggestions([]);
      return;
    }

    const q = locationInput.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/autocomplete?input=${encodeURIComponent(q)}`);
        const data = await resp.json();
        if (!resp.ok || data.error) {
          setSuggestions([]);
          return;
        }
        setSuggestions(data.suggestions || []);
        setActiveSuggestion(-1);
      } catch {
        setSuggestions([]);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [locationInput, isEditingOrigin]);

  const selectSuggestion = async (text: string) => {
    setLocationInput(text);
    setSuggestions([]);
    await handleManualLocationSubmit(text);
  };


  const handleStart = () => {
    setHasRequested(true);
    requestLocation();
  };

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-luxury-black text-luxury-white' : 'bg-luxury-white text-luxury-black'}`}>
      {/* Header */}
      <nav className="p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-current rounded-full flex items-center justify-center">
            <Fuel className={`${isDarkMode ? 'text-luxury-black' : 'text-luxury-white'} w-5 h-5`} />
          </div>
          <span className="font-display font-bold text-xl tracking-tighter uppercase">LuxeFuel</span>
        </div>
        
        <button 
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="p-2 rounded-full border border-current opacity-20 hover:opacity-100 transition-opacity"
        >
          {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {!hasRequested ? (
            <motion.section
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center text-center py-20"
            >
              <h1 className="font-display text-5xl md:text-8xl font-bold tracking-tighter mb-6 uppercase leading-[0.9]">
                Find the Best <br /> 
                <span className="opacity-40 italic font-light">Fuel Near You</span>
              </h1>
              <p className="max-w-xl text-lg opacity-60 mb-12 font-light leading-relaxed">
                Experience minimalist luxury while optimizing your journey. Accurate locations, estimated prices, and refined design.
              </p>
              
              <button
                id="start-search-btn"
                onClick={handleStart}
                className={`group flex items-center gap-4 px-10 py-5 rounded-full border border-current font-medium transition-all hover:scale-105 active:scale-95 ${
                  isDarkMode ? 'hover:bg-luxury-white hover:text-luxury-black' : 'hover:bg-luxury-black hover:text-luxury-white'
                }`}
              >
                Allow Location Access
                <ArrowRight className="transition-transform group-hover:translate-x-2" size={20} />
              </button>
            </motion.section>
          ) : locLoading || fetchingStations ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-40"
            >
              <Loader2 className="animate-spin mb-4" size={48} />
              <p className="font-display uppercase tracking-widest text-sm opacity-40">Architecting your journey...</p>
            </motion.div>
          ) : locError ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20"
            >
              <h2 className="text-2xl font-light mb-4">Location Needed</h2>
              <p className="opacity-60 mb-8">{locError}</p>
              <button 
                onClick={handleStart}
                className="underline underline-offset-4 hover:opacity-100 opacity-60 transition-opacity"
              >
                Try again
              </button>
            </motion.div>
          ) : (
            <motion.section
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              {/* Results Hero */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-current border-opacity-10 pb-12">
                <div className="max-w-full">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] opacity-40 mb-2 font-bold">
                    <MapPin size={12} />
                    Current Origin
                  </div>
                  <h2 className="text-2xl md:text-4xl font-display font-bold uppercase">
                    {isEditingOrigin ? (
                      <div className="relative w-full">
                        <div className="flex items-center gap-3">
                          <input
                            autoFocus
                            value={locationInput}
                            onChange={(e) => setLocationInput(e.target.value)}
                            onBlur={() => {
                              setTimeout(() => {
                                setSuggestions([]);
                              }, 120);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setActiveSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
                                return;
                              }
                              if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setActiveSuggestion((prev) => Math.max(prev - 1, 0));
                                return;
                              }
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
                                  void selectSuggestion(suggestions[activeSuggestion].text);
                                } else {
                                  void handleManualLocationSubmit();
                                }
                                return;
                              }
                              if (e.key === 'Escape') {
                                setIsEditingOrigin(false);
                                setManualError(null);
                                setSuggestions([]);
                                setLocationInput(manualAddress || address || '');
                              }
                            }}
                            className="w-full bg-transparent outline-none text-2xl md:text-4xl font-display font-bold uppercase tracking-tight"
                            placeholder="Type location..."
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { void handleManualLocationSubmit(); }}
                            className="shrink-0 text-[10px] uppercase tracking-[0.25em] font-bold border border-current border-opacity-25 rounded-full px-4 py-2 opacity-80 hover:opacity-100 transition-opacity"
                          >
                            Update
                          </button>
                        </div>
                        {suggestions.length > 0 && (
                          <div className="absolute top-full left-0 mt-2 w-full rounded-2xl border border-current border-opacity-15 backdrop-blur bg-black/70 z-[999] overflow-hidden shadow-2xl">
                            {suggestions.slice(0, 6).map((s, i) => (
                              <button
                                key={`${s.place}-${i}`}
                                type="button"
                                onMouseDown={() => { void selectSuggestion(s.text); }}
                                className={`w-full text-left px-4 py-3 text-sm font-sans tracking-wide transition-colors ${
                                  i === activeSuggestion ? 'bg-white/15' : 'bg-transparent hover:bg-white/10'
                                }`}
                              >
                                {s.text}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setManualError(null);
                          setIsEditingOrigin(true);
                        }}
                        className="text-left w-full truncate hover:opacity-90 transition-opacity"
                        title="Click to edit location"
                      >
                        {(manualAddress || address)?.split(',')[0] || 'Refined Locale'}
                      </button>
                    )}
                    <span
                      onClick={() => setIsEditingOrigin(true)}
                      className="block text-sm font-normal opacity-40 mt-1 lowercase truncate font-sans tracking-normal cursor-text"
                      title="Click to edit location"
                    >
                      {manualAddress || address || 'Detecting refined coordinates...'}
                    </span>
                  </h2>
                  {manualError && (
                    <p className="mt-2 text-[10px] uppercase tracking-[0.15em] opacity-50">{manualError}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs uppercase tracking-[0.2em] opacity-40 mb-1 font-bold">Found</div>
                  <div className="text-4xl font-display font-bold">
                    {stations.length} <span className="text-xl font-light italic">Stations</span>
                  </div>
                </div>
              </div>

              {/* Station Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {stations.length === 0 && !fetchingStations && (
                   <div className="col-span-full py-20 text-center opacity-40 uppercase tracking-widest text-sm">
                      No stations found in the immediate perimeter.
                   </div>
                )}
                {stations.map((station, idx) => (
                  (() => {
                    const regularFuel = station.fuelPrices?.find(f => f.type === 'REGULAR_UNLEADED') || station.fuelPrices?.[0];
                    const otherFuels = (station.fuelPrices || []).filter(f => f.type !== regularFuel?.type);
                    const showPrimaryPrice = regularFuel && Number.isFinite(regularFuel.price);
                    return (
                  <motion.div
                    key={station.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    id={`station-${station.id}`}
                    className={`p-8 rounded-3xl border border-current border-opacity-5 hover:border-opacity-30 transition-all group flex flex-col justify-between h-[340px] ${
                      isDarkMode ? 'bg-luxury-gray-900 shadow-[20px_20px_60px_#050505,-20px_-20px_60px_#0f0f0f]' : 'bg-luxury-gray-100 shadow-[20px_20px_60px_#d1d1d1,-20px_-20px_60px_#ffffff]'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-6">
                        <div className="w-12 h-12 rounded-2xl overflow-hidden border border-current border-opacity-20 bg-current bg-opacity-10 flex items-center justify-center">
                          {station.logoImage ? (
                            <img
                              src={station.logoImage}
                              alt={`${station.name} location image`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <Fuel size={20} />
                          )}
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] opacity-40 uppercase tracking-[0.2em] font-bold">Distance</span>
                          <span className="font-display font-bold text-lg">{station.distance} <span className="text-sm font-normal opacity-40 lowercase">km</span></span>
                        </div>
                      </div>
                      
                      <h3 className="text-2xl font-display font-bold uppercase tracking-tight group-hover:italic transition-all leading-tight mb-2">
                        {station.name}
                      </h3>
                      <p className="text-[10px] uppercase tracking-[0.2em] opacity-40 font-bold">{station.vicinity || station.brand}</p>
                      <img
                        src={`https://maps.googleapis.com/maps/api/staticmap?center=${station.lat},${station.lon}&zoom=15&size=600x180&maptype=roadmap&markers=color:red%7C${station.lat},${station.lon}&key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}`}
                        alt={`${station.name} map with marker`}
                        className="mt-3 w-full h-[84px] object-cover rounded-xl border border-current border-opacity-10"
                        loading="lazy"
                      />
                    </div>

                    <div className="flex justify-between items-end">
                      <div>
                        <span className="text-[10px] uppercase tracking-[0.2em] opacity-40 block mb-1 font-bold">Fuel Price</span>
                        <div className="text-4xl font-display font-bold leading-none">
                          {showPrimaryPrice
                            ? `$${regularFuel.price.toFixed(2)} ${regularFuel.currencyCode}`
                            : 'N/A'}
                        </div>
                        {otherFuels.length > 0 && (
                          <>
                            <button
                              onClick={() => setExpandedPrices(prev => ({ ...prev, [station.id]: !prev[station.id] }))}
                              className="mt-2 text-[10px] uppercase tracking-[0.18em] opacity-70 flex items-center gap-1"
                            >
                              More prices
                              <ChevronDown
                                size={14}
                                className={`transition-transform duration-300 ${expandedPrices[station.id] ? 'rotate-180' : ''}`}
                              />
                            </button>
                            <AnimatePresence initial={false}>
                              {expandedPrices[station.id] && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.25 }}
                                  className="overflow-hidden mt-2 text-[11px] opacity-70"
                                >
                                  {otherFuels.slice(0, 3).map((fuel) => (
                                    <div key={fuel.type} className="flex justify-between gap-2">
                                      <span>{fuel.type.replaceAll('_', ' ')}</span>
                                      <span>{`$${fuel.price.toFixed(2)} ${fuel.currencyCode}`}</span>
                                    </div>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </>
                        )}
                      </div>
                      
                      <button 
                         title="Navigate"
                         className={`w-14 h-14 rounded-full border border-current border-opacity-20 flex items-center justify-center transition-all duration-500 group-hover:bg-current group-hover:scale-110 active:scale-95 ${
                            isDarkMode ? 'group-hover:text-luxury-black' : 'group-hover:text-luxury-white'
                         }`}
                         onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}`, '_blank', 'no-referrer')}
                      >
                        <Navigation size={22} />
                      </button>
                    </div>
                  </motion.div>
                    );
                  })()
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-7xl mx-auto p-8 mt-20 border-t border-current border-opacity-5 flex flex-col md:flex-row justify-between items-center gap-4 opacity-30 text-[10px] uppercase tracking-[0.3em] font-bold">
        <span>© 2026 LuxeFuel Studio · Refined Mobility</span>
        <div className="flex gap-8">
          <span className="hover:opacity-100 cursor-help transition-opacity">Terms of Use</span>
          <span className="hover:opacity-100 cursor-help transition-opacity">Privacy Policy</span>
        </div>
      </footer>
    </div>
  );
}
