export interface GasStation {
  id: string;
  name: string;
  distance?: number; // Calculated on frontend or backend
  // Google Places API does not expose direct gas-per-gallon pricing.
  // This is Places "price_level" (0-4) when available, else null.
  price: number | null;
  priceType: 'fuel_options_price' | 'unavailable';
  brand: string;
  vicinity?: string | null;
  rating?: number | null;
  userRatingsTotal?: number | null;
  logoImage?: string | null;
  fuelType?: string | null;
  fuelCurrency?: string | null;
  fuelOptionsCount?: number;
  hasFuelOptions?: boolean;
  fuelPrices?: Array<{
    type: string;
    price: number;
    currencyCode: string;
  }>;
  photoName?: string | null;
  hasPhoto?: boolean;
  lat: number;
  lon: number;
}

export const fetchGasStations = async (lat: number, lon: number): Promise<GasStation[]> => {
  try {
    const url = `/api/gas-stations?lat=${lat}&lon=${lon}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok || data.error) throw new Error(data.error || 'Failed to fetch gas stations');

    // Calculate distance on client-side for precision
    return data.map((station: GasStation) => ({
      ...station,
      distance: parseFloat(calculateDistance(lat, lon, station.lat, station.lon).toFixed(1))
    })).sort((a: GasStation, b: GasStation) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  } catch (err) {
    console.error('Error fetching gas stations:', err);
    return [];
  }
};

// Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
