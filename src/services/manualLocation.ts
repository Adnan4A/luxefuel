export const resolveManualLocationQuery = (stateInput: string, overrideInput?: string) => {
  const raw = (overrideInput ?? stateInput).trim();
  return raw;
};

export const buildGeocodeAddressUrl = (query: string) =>
  `/api/geocode-address?address=${encodeURIComponent(query)}`;
