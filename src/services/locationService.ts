import { useState, useEffect } from 'react';

export interface LocationState {
  coords: {
    latitude: number;
    longitude: number;
  } | null;
  address: string | null;
  loading: boolean;
  error: string | null;
}

export const useLocation = () => {
  const [state, setState] = useState<LocationState>({
    coords: null,
    address: null,
    loading: false,
    error: null,
  });

  const requestLocation = () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!window.isSecureContext && !isLocalhost) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: 'Location requires a secure origin. Use https:// or open this app on localhost.',
      }));
      return;
    }
    
    if (!navigator.geolocation) {
      setState(prev => ({ ...prev, loading: false, error: 'Geolocation is not supported by your browser' }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setState(prev => ({ ...prev, coords: { latitude, longitude } }));
        
        try {
          const response = await fetch(
            `/api/geocode?lat=${latitude}&lon=${longitude}`
          );
          const data = await response.json();
          if (data.address) {
            setState(prev => ({ ...prev, address: data.address, loading: false }));
          } else {
            setState(prev => ({ ...prev, loading: false }));
          }
        } catch (err) {
          console.error('Error fetching address:', err);
          setState(prev => ({ ...prev, loading: false })); 
        }
      },
      (error) => {
        let message = 'Unable to get your location.';

        if (error.code === error.PERMISSION_DENIED) {
          message = 'Location permission was denied by the browser.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message = 'Location is currently unavailable. Please check device location services.';
        } else if (error.code === error.TIMEOUT) {
          message = 'Location request timed out. Please try again.';
        }

        if (error.message) {
          message = `${message} (${error.message})`;
        }

        setState(prev => ({ ...prev, loading: false, error: message }));
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
  };

  return { ...state, requestLocation };
};
