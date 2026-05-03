import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const fetchNearbyPlaces = async (latitude: number, longitude: number, radiusMeters: number, apiKey: string) => {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.name',
          'places.displayName',
          'places.formattedAddress',
          'places.location',
          'places.fuelOptions.fuelPrices',
          'places.photos.name',
        ].join(','),
      },
      body: JSON.stringify({
        includedTypes: ['gas_station'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: radiusMeters,
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Nearby search failed: ${body}`);
    }

    const data = await response.json();
    return data?.places || [];
  };

  const computeOffset = (lat: number, lon: number, distanceKm: number, bearingDeg: number) => {
    const earthRadiusKm = 6371;
    const bearing = bearingDeg * Math.PI / 180;
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const angDist = distanceKm / earthRadiusKm;

    const newLat = Math.asin(
      Math.sin(latRad) * Math.cos(angDist) +
      Math.cos(latRad) * Math.sin(angDist) * Math.cos(bearing)
    );
    const newLon = lonRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angDist) * Math.cos(latRad),
      Math.cos(angDist) - Math.sin(latRad) * Math.sin(newLat)
    );

    return {
      latitude: newLat * 180 / Math.PI,
      longitude: newLon * 180 / Math.PI,
    };
  };

  const distanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
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

  const buildSweepPoints = (centerLat: number, centerLon: number, radiusKm: number) => {
    const points: { latitude: number; longitude: number }[] = [{ latitude: centerLat, longitude: centerLon }];
    const ringFractions = [0.38, 0.7, 0.95];
    const ringBearings = radiusKm <= 10 ? 8 : radiusKm <= 15 ? 12 : 16;

    for (const fraction of ringFractions) {
      const ringRadius = radiusKm * fraction;
      for (let i = 0; i < ringBearings; i++) {
        const bearing = (360 / ringBearings) * i;
        points.push(computeOffset(centerLat, centerLon, ringRadius, bearing));
      }
    }

    return points;
  };

  // API Routes
  app.get('/api/gas-stations', async (req, res) => {
    const { lat, lon } = req.query;
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
    
    if (!lat || !lon) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    try {
      const radius = 5000;
      const url = 'https://places.googleapis.com/v1/places:searchNearby';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey || '',
          'X-Goog-FieldMask': [
            'places.id',
            'places.name',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.rating',
            'places.userRatingCount',
            'places.fuelOptions.fuelPrices',
            'places.photos.name',
          ].join(','),
        },
        body: JSON.stringify({
          includedTypes: ['gas_station'],
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: {
                latitude: Number(lat),
                longitude: Number(lon),
              },
              radius,
            },
          },
        }),
      });

      const data = await response.json();
      if (!data?.places) return res.json([]);

      const stations = await Promise.all(
        data.places.map(async (place: any) => {
          let placeData = place;

          // Nearby results may omit fuel/photo fields for some places.
          if (!placeData?.fuelOptions || !placeData?.photos?.length) {
            try {
              const placeResourceName = place?.name;
              if (!placeResourceName) {
                throw new Error('Missing place resource name for details lookup');
              }
              const detailsResp = await fetch(`https://places.googleapis.com/v1/${placeResourceName}`, {
                headers: {
                  'X-Goog-Api-Key': apiKey || '',
                  'X-Goog-FieldMask': [
                    'id',
                    'name',
                    'displayName',
                    'formattedAddress',
                    'location',
                    'rating',
                    'userRatingCount',
                    'fuelOptions.fuelPrices',
                    'photos.name',
                  ].join(','),
                },
              });
              if (detailsResp.ok) {
                const details = await detailsResp.json();
                placeData = {
                  ...placeData,
                  ...details,
                  fuelOptions: details?.fuelOptions ?? placeData?.fuelOptions,
                  photos: details?.photos ?? placeData?.photos,
                };
              }
            } catch (detailsError) {
              console.error('Place Details fallback failed:', detailsError);
            }
          }

          const firstPhotoName = placeData?.photos?.[0]?.name || null;
          const logoImage = firstPhotoName
            ? `/api/place-photo?photoName=${encodeURIComponent(firstPhotoName)}&maxHeightPx=120`
            : null;

        const fuelPrices = placeData?.fuelOptions?.fuelPrices ?? [];
        const regularFuel = fuelPrices.find((p: any) =>
          String(p?.type || '').toUpperCase().includes('REGULAR')
        ) || fuelPrices[0];
        const mappedFuelPrices = fuelPrices.map((fuel: any) => {
          const units = Number(fuel?.price?.units ?? 0);
          const nanos = Number(fuel?.price?.nanos ?? 0);
          const value = units + nanos / 1_000_000_000;
          return {
            type: fuel?.type || 'UNKNOWN',
            price: Number(value.toFixed(3)),
            currencyCode: fuel?.price?.currencyCode || 'USD',
          };
        });

          const units = Number(regularFuel?.price?.units ?? 0);
          const nanos = Number(regularFuel?.price?.nanos ?? 0);
          const numericPrice = regularFuel ? units + nanos / 1_000_000_000 : null;

          return {
            id: placeData.id,
            name: placeData?.displayName?.text || 'Unknown Station',
            brand: placeData?.displayName?.text || 'Unknown Station',
            vicinity: placeData?.formattedAddress || null,
            rating: placeData?.rating ?? null,
            userRatingsTotal: placeData?.userRatingCount ?? null,
            price: numericPrice != null ? Number(numericPrice.toFixed(3)) : null,
            priceType: numericPrice != null ? 'fuel_options_price' : 'unavailable',
            fuelType: regularFuel?.type || null,
            fuelCurrency: regularFuel?.price?.currencyCode || null,
            fuelOptionsCount: fuelPrices.length,
            hasFuelOptions: fuelPrices.length > 0,
            fuelPrices: mappedFuelPrices,
            logoImage,
            photoName: firstPhotoName,
            hasPhoto: Boolean(firstPhotoName),
            lat: placeData?.location?.latitude,
            lon: placeData?.location?.longitude,
          };
        })
      );

      const validStations = stations.filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lon));

      res.json(validStations);
    } catch (error) {
      console.error('Error in /api/gas-stations:', error);
      res.status(500).json({ error: 'Failed to fetch gas stations' });
    }
  });

  app.get('/api/cheapest-gas', async (req, res) => {
    const { lat, lon, radiusKm = '15', fuelType = 'REGULAR_UNLEADED', bbox, includeDiscovery = '0' } = req.query;
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!lat || !lon) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    if (!apiKey) {
      return res.status(500).json({ error: 'Google Maps API key is missing' });
    }

    try {
      const startedAt = Date.now();
      const centerLat = Number(lat);
      const centerLon = Number(lon);
      const radius = Math.min(25, Math.max(5, Number(radiusKm)));
      const selectedFuelType = String(fuelType).toUpperCase();
      const shouldIncludeDiscovery = String(includeDiscovery) === '1';
      const discoveryRadiusKm = 50;
      const bboxText = typeof bbox === 'string' ? bbox : '';
      let cityBounds: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null = null;
      if (bboxText) {
        const parts = bboxText.split(',').map((v) => Number(v.trim()));
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
          cityBounds = {
            minLat: Math.min(parts[0], parts[2]),
            minLon: Math.min(parts[1], parts[3]),
            maxLat: Math.max(parts[0], parts[2]),
            maxLon: Math.max(parts[1], parts[3]),
          };
        }
      }

      const buildCandidatesForRadius = async (scanRadiusKm: number) => {
        const sweepPoints = buildSweepPoints(centerLat, centerLon, scanRadiusKm);
        const perPointRadiusMeters = Math.min(8500, Math.max(2300, Math.round(scanRadiusKm * 430)));
        const placeMap = new Map<string, any>();

        for (const point of sweepPoints) {
          const places = await fetchNearbyPlaces(point.latitude, point.longitude, perPointRadiusMeters, apiKey);
          for (const place of places) {
            if (place?.id) placeMap.set(place.id, place);
          }
        }

        const candidates = Array.from(placeMap.values()).map((place: any) => {
        const fuelPrices = place?.fuelOptions?.fuelPrices ?? [];
        const matchingFuel =
          fuelPrices.find((f: any) => String(f?.type || '').toUpperCase() === selectedFuelType) ||
          fuelPrices.find((f: any) => String(f?.type || '').toUpperCase().includes('REGULAR')) ||
          fuelPrices[0];

        if (!matchingFuel) return null;

        const units = Number(matchingFuel?.price?.units ?? 0);
        const nanos = Number(matchingFuel?.price?.nanos ?? 0);
        const numericPrice = units + nanos / 1_000_000_000;

        const station = {
          id: place.id,
          name: place?.displayName?.text || 'Unknown Station',
          address: place?.formattedAddress || null,
          fuelType: matchingFuel?.type || null,
          currencyCode: matchingFuel?.price?.currencyCode || 'USD',
          price: Number(numericPrice.toFixed(3)),
          lat: place?.location?.latitude,
          lon: place?.location?.longitude,
          distanceKm: Number(
            distanceKm(centerLat, centerLon, place?.location?.latitude, place?.location?.longitude).toFixed(1)
          ),
          image: place?.photos?.[0]?.name
            ? `/api/place-photo?photoName=${encodeURIComponent(place.photos[0].name)}&maxHeightPx=160`
            : null,
        };
        if (!Number.isFinite(station.price) || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) {
          return null;
        }
        if (cityBounds) {
          const inBounds =
            station.lat >= cityBounds.minLat &&
            station.lat <= cityBounds.maxLat &&
            station.lon >= cityBounds.minLon &&
            station.lon <= cityBounds.maxLon;
          if (!inBounds) return null;
        }
        if (station.distanceKm > scanRadiusKm + 0.05) {
          return null;
        }
        return station;
      }).filter((x: any) => x);
        return {
          sweepPointCount: sweepPoints.length,
          perPointRadiusMeters,
          scannedStations: placeMap.size,
          candidates,
        };
      };

      const inRadiusScan = await buildCandidatesForRadius(radius);
      const candidates = inRadiusScan.candidates.filter((station: any) => station.distanceKm <= radius + 0.05);
      const sorted = candidates.sort((a: any, b: any) => a.price - b.price);
      const topResults = sorted.slice(0, 10);
      const cheapest = sorted[0] || null;

      let cheapestIn50Km = null;
      if (shouldIncludeDiscovery) {
        const discoveryScan = await buildCandidatesForRadius(discoveryRadiusKm);
        const discoveryCandidates = discoveryScan.candidates
          .filter((station: any) => station.distanceKm <= discoveryRadiusKm + 0.05)
          .sort((a: any, b: any) => a.price - b.price);
        cheapestIn50Km = discoveryCandidates[0] || null;
      }

      const elapsedMs = Date.now() - startedAt;
      console.info('[api][cheapest-gas] complete', {
        includeDiscovery: shouldIncludeDiscovery,
        radiusKm: radius,
        discoveryRadiusKm,
        scannedStations: inRadiusScan.scannedStations,
        pricedStations: sorted.length,
        topCount: topResults.length,
        hasCheapestIn50Km: Boolean(cheapestIn50Km),
        elapsedMs,
      });

      return res.json({
        center: { lat: centerLat, lon: centerLon },
        radiusKm: radius,
        fuelType: selectedFuelType,
        discoveryRadiusKm,
        discoveryIncluded: shouldIncludeDiscovery,
        scanPlan: {
          sweepPointCount: inRadiusScan.sweepPointCount,
          perPointRadiusMeters: inRadiusScan.perPointRadiusMeters,
        },
        scannedStations: inRadiusScan.scannedStations,
        pricedStations: sorted.length,
        cheapest,
        cheapestIn50Km,
        topResults,
        elapsedMs,
      });
    } catch (error) {
      console.error('Error in /api/cheapest-gas:', error);
      return res.status(500).json({ error: 'Failed to compute cheapest gas' });
    }
  });

  app.get('/api/place-photo', async (req, res) => {
    const { photoName, maxHeightPx } = req.query;
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!photoName || typeof photoName !== 'string') {
      return res.status(400).json({ error: 'photoName is required' });
    }

    try {
      const height = typeof maxHeightPx === 'string' ? maxHeightPx : '120';
      const normalizedPhotoName = photoName.replace(/^\/+/, '');
      const photoUrl = `https://places.googleapis.com/v1/${normalizedPhotoName}/media?maxHeightPx=${height}&key=${apiKey}`;
      const response = await fetch(photoUrl);

      if (!response.ok) {
        const body = await response.text();
        return res.status(response.status).json({ error: `Failed to fetch place photo: ${body}` });
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(imageBuffer);
    } catch (error) {
      console.error('Error in /api/place-photo:', error);
      return res.status(500).json({ error: 'Failed to fetch place photo' });
    }
  });

  app.get('/api/geocode', async (req, res) => {
    const { lat, lon } = req.query;
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!lat || !lon) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        res.json({ address: data.results[0].formatted_address });
      } else {
        res.json({ address: null });
      }
    } catch (error) {
      console.error('Error in /api/geocode:', error);
      res.status(500).json({ error: 'Failed to geocode' });
    }
  });

  app.get('/api/geocode-address', async (req, res) => {
    const { address } = req.query;
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Address is required' });
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        return res.json({
          address: result.formatted_address,
          lat: result.geometry?.location?.lat ?? null,
          lon: result.geometry?.location?.lng ?? null,
        });
      }

      return res.status(404).json({ error: 'Address not found' });
    } catch (error) {
      console.error('Error in /api/geocode-address:', error);
      return res.status(500).json({ error: 'Failed to geocode address' });
    }
  });

  app.get('/api/autocomplete', async (req, res) => {
    const { input } = req.query;
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({ error: 'input is required' });
    }

    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey || '',
          'X-Goog-FieldMask': 'suggestions.placePrediction.place,suggestions.placePrediction.text,suggestions.queryPrediction.text',
        },
        body: JSON.stringify({
          input,
          includeQueryPredictions: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({ error: data?.error?.message || 'Autocomplete failed' });
      }

      const suggestions = (data?.suggestions || [])
        .map((s: any) => ({
          place: s?.placePrediction?.place || null,
          text: s?.placePrediction?.text?.text || s?.queryPrediction?.text?.text || null,
        }))
        .filter((s: any) => s.text);

      return res.json({ suggestions });
    } catch (error) {
      console.error('Error in /api/autocomplete:', error);
      return res.status(500).json({ error: 'Failed to fetch autocomplete suggestions' });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
