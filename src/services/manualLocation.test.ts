import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeocodeAddressUrl, resolveManualLocationQuery } from './manualLocation';

test('uses selected suggestion instead of stale state and encodes URL', () => {
  const oldInput = 'Van';
  const selectedSuggestion = 'Vancouver, BC';

  const query = resolveManualLocationQuery(oldInput, selectedSuggestion);
  const url = buildGeocodeAddressUrl(query);

  assert.equal(query, 'Vancouver, BC');
  assert.equal(url, '/api/geocode-address?address=Vancouver%2C%20BC');
  assert.equal(url.includes('address=Van&'), false);
});
