import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPath, lookup } from './worker.mjs';

test('passes only shipment lookup fields and preserves uncertain event time', async () => {
  let passed;
  const response = await lookup({ number: ' AB 123456789 CD ', carrier: 'royal-mail', postcode: 'SW1A 1AA', name: 'ignored' }, () => ({
    track: async input => { passed = input; return { source: 'Royal Mail', carrier: 'royal-mail', result: { current_stage: 'in_transit', events: [{ local_time: '2026-11-01 10:30', description: 'Accepted', stage: 'accepted' }] } }; },
  }));
  assert.deepEqual(passed, { number: 'AB123456789CD', carrier: 'royal-mail', postcode: 'SW1A 1AA' });
  assert.equal(response.stage, 'in_transit');
  assert.equal(response.events[0].time, null);
  assert.equal(response.events[0].local_time, '2026-11-01 10:30');
});

test('does not turn unknown or empty tracking into success', async () => {
  const response = await lookup({ number: '1234567890' }, () => ({ track: async () => ({ result: {} }) }));
  assert.equal(response.ok, false);
  assert.equal(response.kind, 'indeterminate');
});

test('uses the latest dated delivery event if the summary has no delivery time', async () => {
  const response = await lookup({ number: '1234567890' }, () => ({ track: async () => ({ result: { current_stage: 'delivered', events: [
    { stage: 'delivered', local_time: '2026-11-03 15:00' },
    { stage: 'delivered', instant: '2026-11-04T15:00:00Z' },
  ] } }) }));
  assert.equal(response.delivered_at, '2026-11-04T15:00:00Z');
});

test('failure messages never include parcel data from source errors', async () => {
  const response = await lookup({ number: '1234567890' }, () => ({ track: async () => { throw { message: 'secret number and address', hint: { kind: 'rate_limited', retryAfterMs: 90000 } }; } }));
  assert.equal(response.error, 'The carrier is limiting requests. Try again later.');
  assert.equal(response.retry_after_ms, 90000);
});

test('invalid input cannot trigger a network call', async () => {
  const response = await lookup({ number: '../evil' }, () => { throw new Error('must not be called'); });
  assert.equal(response.kind, 'invalid_input');
});

test('enables the free fallback sources for carriers that block direct checks', async () => {
  let options;
  await lookup({ number: '9214490123456789012345', carrier: 'usps' }, opts => { options = opts; return { track: async () => ({ result: { current_stage: 'registered', events: [] } }) }; });
  assert.deepEqual(options.providers, ['UPU', 'ParcelsApp', 'Ship24']);
});

test('finds browser using Windows install locations', () => {
  const path = browserPath({ PROGRAMFILES: 'C:\\Programs' }, p => p.endsWith('Chrome\\Application\\chrome.exe'));
  assert.ok(path?.endsWith('Chrome\\Application\\chrome.exe'));
});
