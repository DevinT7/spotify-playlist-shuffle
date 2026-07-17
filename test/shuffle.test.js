'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { secureRandomInt, fisherYates, spreadArtists, trueShuffle } = require('../src/shared/shuffle');

test('secureRandomInt stays in range', () => {
  for (let i = 0; i < 5000; i++) {
    const v = secureRandomInt(7);
    assert.ok(v >= 0 && v < 7);
  }
});

test('secureRandomInt is roughly uniform', () => {
  const counts = new Array(5).fill(0);
  const n = 50000;
  for (let i = 0; i < n; i++) counts[secureRandomInt(5)]++;
  for (const c of counts) {
    // expect 10000 each; allow ±5% — generous vs binomial std dev (~89)
    assert.ok(Math.abs(c - n / 5) < n / 100, `bucket count ${c} too far from ${n / 5}`);
  }
});

test('fisherYates returns a permutation (no lost/duplicated items)', () => {
  const input = Array.from({ length: 500 }, (_, i) => ({ uri: 'u' + i }));
  const out = fisherYates([...input]);
  assert.strictEqual(out.length, input.length);
  assert.deepStrictEqual(
    out.map((t) => t.uri).sort(),
    input.map((t) => t.uri).sort()
  );
});

test('fisherYates: each item is roughly equally likely in first position', () => {
  const n = 10;
  const trials = 20000;
  const firstCounts = new Array(n).fill(0);
  for (let t = 0; t < trials; t++) {
    const arr = fisherYates(Array.from({ length: n }, (_, i) => i));
    firstCounts[arr[0]]++;
  }
  const expected = trials / n;
  for (const c of firstCounts) {
    assert.ok(Math.abs(c - expected) < expected * 0.15, `first-position count ${c} vs expected ${expected}`);
  }
});

test('spreadArtists avoids adjacent same-artist when possible', () => {
  const tracks = [
    { uri: '1', artist: 'A' },
    { uri: '2', artist: 'A' },
    { uri: '3', artist: 'B' },
    { uri: '4', artist: 'A' },
    { uri: '5', artist: 'B' },
    { uri: '6', artist: 'C' },
  ];
  const out = spreadArtists([...tracks]);
  assert.strictEqual(out.length, tracks.length);
  assert.deepStrictEqual(out.map((t) => t.uri).sort(), ['1', '2', '3', '4', '5', '6']);
  let adjacent = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i].artist === out[i - 1].artist) adjacent++;
  }
  assert.ok(adjacent <= 1, `too many adjacent same-artist pairs: ${adjacent}`);
});

test('trueShuffle does not mutate its input', () => {
  const input = [{ uri: 'a', artist: 'X' }, { uri: 'b', artist: 'Y' }, { uri: 'c', artist: 'Z' }];
  const snapshot = JSON.stringify(input);
  trueShuffle(input, { avoidRepeatArtists: true });
  assert.strictEqual(JSON.stringify(input), snapshot);
});
