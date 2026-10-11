import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildDestinations, batchOptionLabel } from '../lib/destinations';
import type { Tour } from '../lib/types';

const tour = (over: Partial<Tour> & Pick<Tour, 'id'>): Tour => ({
  name: 'A Tour', slot: 'morning', pickupPoint: 'Main pickup area',
  departureTime: '08:00', date: '', capacity: 20, registeredCount: 0,
  active: true, order: 1, destinationId: over.id, batch: null,
  restrictedNationalities: [], experienceDuration: '', notices: [],
  ...over,
});

describe('buildDestinations', () => {
  it('groups the batches of one destination under a single entry', () => {
    const out = buildDestinations([
      tour({ id: 'sabic-b1', destinationId: 'sabic', batch: 1, departureTime: '08:00', order: 2 }),
      tour({ id: 'sabic-b2', destinationId: 'sabic', batch: 2, departureTime: '09:00', order: 3 }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'sabic');
    assert.equal(out[0].hasBatches, true);
    assert.deepEqual(out[0].batches.map((b) => b.id), ['sabic-b1', 'sabic-b2']);
  });

  it('sorts batches by batch number, not by insertion order', () => {
    const out = buildDestinations([
      tour({ id: 'b2', destinationId: 'd', batch: 2, departureTime: '10:00' }),
      tour({ id: 'b1', destinationId: 'd', batch: 1, departureTime: '09:00' }),
    ]);
    assert.deepEqual(out[0].batches.map((b) => b.batch), [1, 2]);
  });

  // The bug this guards against: a stale un-batched SABIC row showing an 08:30
  // departure next to the real Batch 1 and Batch 2.
  it('hides an un-batched row once the destination has batches', () => {
    const out = buildDestinations([
      tour({ id: 'sabic-old', destinationId: 'sabic', batch: null, departureTime: '08:30', capacity: 50 }),
      tour({ id: 'sabic-b1', destinationId: 'sabic', batch: 1, departureTime: '08:00' }),
      tour({ id: 'sabic-b2', destinationId: 'sabic', batch: 2, departureTime: '09:00' }),
    ]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].batches.map((b) => b.id), ['sabic-b1', 'sabic-b2']);
    assert.ok(!out[0].batches.some((b) => b.departureTime === '08:30'), 'no stale 08:30');
    assert.ok(!out[0].batches.some((b) => b.capacity === 50), 'no stale 50-seat option');
  });

  it('keeps a destination that genuinely has no batches', () => {
    const out = buildDestinations([
      tour({ id: 'kapsarc', destinationId: 'kapsarc', batch: null, departureTime: '08:00' }),
    ]);
    assert.equal(out[0].hasBatches, false);
    assert.deepEqual(out[0].batches.map((b) => b.id), ['kapsarc']);
  });

  it('marks a destination full only when every batch is gone', () => {
    const base = { destinationId: 'd' };
    const partly = buildDestinations([
      tour({ id: 'b1', ...base, batch: 1, capacity: 10, registeredCount: 10 }),
      tour({ id: 'b2', ...base, batch: 2, capacity: 10, registeredCount: 3 }),
    ]);
    assert.equal(partly[0].full, false);

    const all = buildDestinations([
      tour({ id: 'b1', ...base, batch: 1, capacity: 10, registeredCount: 10 }),
      tour({ id: 'b2', ...base, batch: 2, capacity: 10, registeredCount: 10 }),
    ]);
    assert.equal(all[0].full, true);
  });

  it('treats a closed batch as unbookable', () => {
    const out = buildDestinations([
      tour({ id: 'b1', destinationId: 'd', batch: 1, active: false }),
      tour({ id: 'b2', destinationId: 'd', batch: 2, active: false }),
    ]);
    assert.equal(out[0].full, true);
  });

  it('applies a restriction found on any batch to the whole destination', () => {
    const out = buildDestinations([
      tour({ id: 'b1', destinationId: 'sabic', batch: 1, restrictedNationalities: ['IQ', 'YE'] }),
      tour({ id: 'b2', destinationId: 'sabic', batch: 2, restrictedNationalities: ['IQ', 'YE'] }),
    ]);
    assert.deepEqual([...out[0].restrictedNationalities].sort(), ['IQ', 'YE']);
  });

  it('orders destinations by their lowest sort order', () => {
    const out = buildDestinations([
      tour({ id: 'late', destinationId: 'late', order: 9 }),
      tour({ id: 'early', destinationId: 'early', order: 1 }),
    ]);
    assert.deepEqual(out.map((d) => d.id), ['early', 'late']);
  });
});

describe('batchOptionLabel', () => {
  it('reads "Batch N · HH:mm · X seats left", with the time from the data', () => {
    assert.equal(
      batchOptionLabel(tour({ id: 'b1', batch: 1, departureTime: '08:00', capacity: 20, registeredCount: 13 })),
      'Batch 1 · 08:00 · 7 seats left'
    );
    assert.equal(
      batchOptionLabel(tour({ id: 'b2', batch: 2, departureTime: '09:00', capacity: 20, registeredCount: 19 })),
      'Batch 2 · 09:00 · 1 seat left'
    );
  });

  it('says Full and Registration closed rather than a seat count', () => {
    assert.match(
      batchOptionLabel(tour({ id: 'b', batch: 1, capacity: 10, registeredCount: 10 })),
      /Full$/
    );
    assert.match(
      batchOptionLabel(tour({ id: 'b', batch: 1, active: false })),
      /Registration closed$/
    );
  });
});
