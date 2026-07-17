'use strict';
// Spotify Web API client — updated for the February/March 2026 Dev Mode changes:
// - GET  /playlists/{id}/items   (was /tracks; only owned/collaborative playlists)
// - POST /me/playlists           (was /users/{id}/playlists)
// - response field renames: tracks->items, track->item
// Handles pagination, 429 rate limits, and one 401 refresh retry.

const API = 'https://api.spotify.com/v1';
const CHUNK = 100; // max uris per playlist items request
const MAX_PLAYLIST = 9900; // Spotify playlist hard cap is 10k

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// walk an object graph looking for a trackList array (embed page JSON)
function deepFindTrackList(obj) {
  const stack = [obj];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== 'object') continue;
    if (Array.isArray(o.trackList) && o.trackList.length) return o.trackList;
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

class Spotify {
  constructor(auth, onProgress = () => {}) {
    this.auth = auth;
    this.progress = onProgress;
  }

  async api(path, { method = 'GET', body, _retried = false, _attempt = 0 } = {}) {
    const token = await this.auth.getAccessToken();
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && !_retried) {
      await this.auth.refresh();
      return this.api(path, { method, body, _retried: true });
    }
    if (res.status === 429 && _attempt < 5) {
      const wait = (Number(res.headers.get('Retry-After')) || 2) * 1000;
      this.progress(`Rate limited — waiting ${Math.round(wait / 1000)}s…`);
      await sleep(wait + 200);
      return this.api(path, { method, body, _retried, _attempt: _attempt + 1 });
    }
    if (res.status === 204) return null;

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      let msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      if (res.status === 403 && path.includes('/playlists/')) {
        msg += ' — Spotify Development Mode apps can only read playlists you own or collaborate on (Feb 2026 policy).';
      }
      if (res.status === 404 && path.includes('/me/player')) {
        msg += ' — no active Spotify device found. Open Spotify on a device and try again.';
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async *_paginate(firstPath) {
    let url = firstPath;
    while (url) {
      const data = await this.api(url);
      yield data;
      url = data && data.next ? data.next : null;
    }
  }

  getMe() {
    return this.api('/me');
  }

  async getPlaylists() {
    const me = await this.getMe();
    const out = [];
    for await (const page of this._paginate('/me/playlists?limit=50')) {
      for (const p of page.items || []) {
        if (!p) continue;
        const meta = p.items || p.tracks; // field renamed tracks -> items in 2026 API
        const images = Array.isArray(p.images) ? p.images : [];
        out.push({
          id: p.id,
          uri: p.uri,
          name: p.name || 'Untitled',
          owner: (p.owner && (p.owner.display_name || p.owner.id)) || 'unknown',
          total: meta && typeof meta.total === 'number' ? meta.total : null,
          imageLarge: images.length ? images[0].url : null,
          imageSmall: images.length ? images[images.length - 1].url : null,
          // Dev Mode apps can only read items of owned/collaborative playlists.
          readable: Boolean(p.collaborative || (p.owner && p.owner.id === me.id)),
        });
      }
    }
    return { me: { id: me.id, name: me.display_name || me.id }, playlists: out };
  }

  _extractTracks(items) {
    const out = [];
    for (const it of items || []) {
      const t = it && (it.item || it.track); // renamed track -> item in 2026 API
      if (t && t.uri && t.uri.startsWith('spotify:track:')) {
        const albumImages = (t.album && Array.isArray(t.album.images) && t.album.images) || [];
        out.push({
          uri: t.uri,
          name: t.name || '?',
          artist: (t.artists || []).map((a) => a.name).join(', '),
          art: albumImages.length ? albumImages[albumImages.length - 1].url : null,
          durationMs: typeof t.duration_ms === 'number' ? t.duration_ms : null,
        });
      }
    }
    return out;
  }

  async getPlaylistTracks(id, label = 'playlist') {
    const out = [];
    for await (const page of this._paginate(`/playlists/${id}/items?limit=50`)) {
      out.push(...this._extractTracks(page.items));
      this.progress(`Loading ${label}… ${out.length} tracks`);
    }
    return out;
  }

  async getLikedTracks() {
    const out = [];
    for await (const page of this._paginate('/me/tracks?limit=50')) {
      out.push(...this._extractTracks(page.items));
      this.progress(`Loading Liked Songs… ${out.length} tracks`);
    }
    return out;
  }

  // DJ mode: liked songs + every readable playlist, deduped.
  async getWholeLibrary(excludeId = null) {
    const { playlists } = await this.getPlaylists();
    const seen = new Map();
    const add = (tracks) => tracks.forEach((t) => seen.has(t.uri) || seen.set(t.uri, t));
    const skipped = [];

    add(await this.getLikedTracks());
    for (const p of playlists.filter((p) => p.readable && p.id !== excludeId)) {
      try {
        add(await this.getPlaylistTracks(p.id, `"${p.name}"`));
      } catch (e) {
        skipped.push(p.name);
        this.progress(`Skipping "${p.name}" (${e.status || 'error'})`);
      }
    }
    return { tracks: [...seen.values()], skipped };
  }

  getDevices() {
    return this.api('/me/player/devices');
  }

  // Reads a PUBLIC playlist's tracks from Spotify's embed page (open.spotify.com/embed).
  // The official API refuses to return items of playlists you don't own (Feb 2026
  // Dev Mode policy), but the embed player data is public. No auth involved.
  // Note: may only expose the first ~100 tracks of very large playlists.
  async getPublicPlaylistTracks(id) {
    const res = await fetch(`https://open.spotify.com/embed/playlist/${encodeURIComponent(id)}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html',
      },
    });
    if (!res.ok) {
      throw new Error(`Could not read the playlist's public page (HTTP ${res.status}). Private playlists can't be copied.`);
    }
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("Couldn't parse the playlist's public page — Spotify may have changed its format.");

    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      throw new Error("Couldn't parse the playlist's public page — Spotify may have changed its format.");
    }

    // usual location, with a deep-search fallback in case the shape shifts
    let list =
      data && data.props && data.props.pageProps && data.props.pageProps.state &&
      data.props.pageProps.state.data && data.props.pageProps.state.data.entity &&
      data.props.pageProps.state.data.entity.trackList;
    if (!Array.isArray(list)) list = deepFindTrackList(data);
    if (!Array.isArray(list) || !list.length) {
      throw new Error('No tracks found on the public page. The playlist may be private or empty.');
    }

    return list
      .filter((t) => t && typeof t.uri === 'string' && t.uri.startsWith('spotify:track:'))
      .map((t) => ({
        uri: t.uri,
        name: t.title || '?',
        artist: t.subtitle || '',
        art: null,
        durationMs: typeof t.duration === 'number' ? t.duration : null,
      }));
  }

  // Copies a locked (non-owned, public) playlist into the user's account.
  async copyLockedPlaylist(id, name, sourceOwner) {
    this.progress('Reading public playlist data…');
    const tracks = await this.getPublicPlaylistTracks(id);
    this.progress(`Found ${tracks.length} tracks — creating your copy…`);
    const p = await this.createPlaylist(
      name,
      `Your copy of "${name}"${sourceOwner ? ` by ${sourceOwner}` : ''} — made by True Shuffle so it can be truly shuffled.`
    );
    await this._fillPlaylist(p.id, tracks.map((t) => t.uri));
    return {
      id: p.id,
      url: (p.external_urls && p.external_urls.spotify) || null,
      count: tracks.length,
    };
  }

  async createPlaylist(name, description) {
    return this.api('/me/playlists', {
      method: 'POST',
      body: { name, description, public: false },
    });
  }

  async _fillPlaylist(id, uris) {
    const chunks = [];
    for (let i = 0; i < uris.length; i += CHUNK) chunks.push(uris.slice(i, i + CHUNK));
    // PUT replaces existing contents with the first chunk, POST appends the rest.
    await this.api(`/playlists/${id}/items`, { method: 'PUT', body: { uris: chunks[0] || [] } });
    for (let i = 1; i < chunks.length; i++) {
      this.progress(`Writing tracks… ${i * CHUNK}/${uris.length}`);
      await this.api(`/playlists/${id}/items`, { method: 'POST', body: { uris: chunks[i] } });
    }
  }

  // Saves a brand-new shuffled playlist. Returns { id, url }.
  async saveAsPlaylist(name, uris) {
    const capped = uris.slice(0, MAX_PLAYLIST);
    const p = await this.createPlaylist(
      name,
      `Truly random order (Fisher-Yates) — created ${new Date().toLocaleString()} by True Shuffle. Play top-to-bottom with shuffle OFF.`
    );
    await this._fillPlaylist(p.id, capped);
    return { id: p.id, url: (p.external_urls && p.external_urls.spotify) || null, count: capped.length };
  }

  // Instant play: write the shuffled order into a reusable hidden queue
  // playlist, force Spotify's own shuffle OFF, then play it from the top.
  async playNow(uris, deviceId, settings) {
    const capped = uris.slice(0, MAX_PLAYLIST);
    let qid = settings.get('queuePlaylistId');
    let quri = settings.get('queuePlaylistUri');

    if (qid) {
      try {
        await this._fillPlaylist(qid, capped);
      } catch (e) {
        if (e.status === 404 || e.status === 403) qid = null; // deleted — recreate
        else throw e;
      }
    }
    if (!qid) {
      const p = await this.createPlaylist(
        '\u{1F3B2} True Shuffle Queue',
        'Rolling queue used by True Shuffle for instant playback. Safe to ignore.'
      );
      qid = p.id;
      quri = p.uri;
      settings.setMany({ queuePlaylistId: qid, queuePlaylistUri: quri });
      await this._fillPlaylist(qid, capped);
    }

    const dev = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    this.progress('Starting playback…');
    await this.api(`/me/player/shuffle${dev ? dev + '&' : '?'}state=false`, { method: 'PUT' }).catch(() => {});
    await this.api(`/me/player/play${dev}`, {
      method: 'PUT',
      body: { context_uri: quri || `spotify:playlist:${qid}`, offset: { position: 0 }, position_ms: 0 },
    });
    return { count: capped.length };
  }
}

module.exports = Spotify;
