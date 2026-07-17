'use strict';
// Unbiased shuffle engine. Uses crypto randomness + rejection sampling so
// every permutation is equally likely (Math.random + modulo both bias results).

const crypto = require('crypto');

// Uniform random integer in [0, maxExclusive) via rejection sampling.
function secureRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('maxExclusive must be a positive integer');
  }
  if (maxExclusive === 1) return 0;
  const range = 0x100000000; // 2^32
  const limit = range - (range % maxExclusive);
  let x;
  do {
    x = crypto.randomBytes(4).readUInt32BE(0);
  } while (x >= limit);
  return x % maxExclusive;
}

// Fisher-Yates: O(n), every permutation equally likely. Mutates and returns arr.
function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function primaryArtist(track) {
  return (track && track.artist ? String(track.artist).split(',')[0] : '').trim().toLowerCase();
}

// Best-effort pass to avoid the same artist twice in a row.
// Keeps the shuffle random; only swaps when neighbors collide.
function spreadArtists(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (primaryArtist(arr[i]) && primaryArtist(arr[i]) === primaryArtist(arr[i - 1])) {
      for (let j = i + 1; j < arr.length; j++) {
        if (primaryArtist(arr[j]) !== primaryArtist(arr[i - 1])) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
          break;
        }
      }
    }
  }
  return arr;
}

// tracks: [{ uri, name, artist }]
function trueShuffle(tracks, { avoidRepeatArtists = false } = {}) {
  const out = fisherYates([...tracks]);
  return avoidRepeatArtists ? spreadArtists(out) : out;
}

module.exports = { secureRandomInt, fisherYates, spreadArtists, trueShuffle, primaryArtist };
