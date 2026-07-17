'use strict';
const $ = (id) => document.getElementById(id);

const MAX_RENDER = 500;

let sources = [];
let selectedKey = null;
let rawTracks = [];
let shuffled = [];
let sourceLabel = '';
let loading = false;

const invoke = async (channel, args) => {
  const res = await window.api.invoke(channel, args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

// ---------- helpers ----------
let toastTimer = null;
function toast(msg, isErr = false, ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
  el.className = isErr ? 'err' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

const setStatus = (id, msg, cls = '') => {
  const el = $(id);
  el.textContent = msg || '';
  el.className = 'status' + (cls ? ' ' + cls : '');
};

function fmtDuration(ms) {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtTotal(tracks) {
  let ms = 0;
  for (const t of tracks) ms += t.durationMs || 0;
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min} min`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

window.api.onProgress((msg) => {
  if (loading) $('loadingMsg').textContent = msg;
});

// ---------- view switching ----------
function show(view) {
  $('onboarding').classList.toggle('hidden', view !== 'onboarding');
  $('app').classList.toggle('hidden', view !== 'app');
}

// main pane: 'home' | 'loading' | 'list'
function mainView(state) {
  $('homeView').classList.toggle('hidden', state !== 'home');
  $('mainHeader').classList.toggle('hidden', state === 'home');
  $('trackArea').classList.toggle('hidden', state === 'home');
  $('loadingState').classList.toggle('hidden', state !== 'loading');
  $('trackList').classList.toggle('hidden', state !== 'list');
  loading = state === 'loading';
  if (state === 'home') {
    selectedKey = null;
    document.querySelectorAll('.source').forEach((el) => el.classList.remove('selected'));
    const home = document.querySelector('.source[data-key="home"]');
    if (home) home.classList.add('selected');
  }
}

// ---------- init ----------
async function init() {
  const s = await invoke('settings:get');
  for (const id of ['obClientId', 'clientId']) $(id).value = s.clientId;
  for (const id of ['obRedirectUri', 'redirectUri']) $(id).value = s.redirectUri;

  const st = await invoke('auth:status');
  if (st.connected) enterApp(st.user);
  else show('onboarding');
}

async function enterApp(user) {
  show('app');
  $('userBox').textContent = `Connected as ${user}`;
  $('greeting').textContent = `${greeting()}, ${String(user).split(' ')[0]}`;
  mainView('home');
  refreshDevices();
  await loadSources();
}

// ---------- connect (onboarding) ----------
$('obConnectBtn').addEventListener('click', async () => {
  const btn = $('obConnectBtn');
  btn.disabled = true;
  try {
    await invoke('settings:set', {
      clientId: $('obClientId').value,
      redirectUri: $('obRedirectUri').value,
    });
    setStatus('obStatus', 'Approve the request in your browser…');
    const { user } = await invoke('auth:connect');
    setStatus('obStatus', '');
    enterApp(user);
  } catch (e) {
    setStatus('obStatus', e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

// ---------- sources (sidebar + home tiles) ----------
async function loadSources() {
  try {
    const { playlists } = await invoke('data:playlists');
    const home = { key: 'home', type: 'home', name: 'Home', icon: '⌂' };
    const mixes = [
      { key: 'library', type: 'library', id: null, name: 'Everything', icon: '🎧', count: '', locked: false, hint: 'liked songs + all your playlists, deduped' },
      { key: 'liked', type: 'liked', id: null, name: 'Liked Songs', icon: '💚', count: '', locked: false },
    ];
    const mine = [];
    const locked = [];
    for (const p of playlists) {
      const item = {
        key: 'pl:' + p.id,
        type: 'playlist',
        id: p.id,
        name: p.name,
        icon: p.readable ? '♪' : '🔒',
        imageSmall: p.imageSmall,
        imageLarge: p.imageLarge,
        count: p.total != null ? String(p.total) : '',
        locked: !p.readable,
        owner: p.owner,
      };
      (p.readable ? mine : locked).push(item);
    }
    sources = [home, ...mixes, ...mine, ...locked];
    renderSidebar({ home, mixes, mine, locked });
    renderHomeTiles(mine);
  } catch (e) {
    toast(e.message, true, 6000);
  }
}

function renderSidebar({ home, mixes, mine, locked }) {
  const nav = $('sourceList');
  nav.innerHTML = '';
  nav.appendChild(sourceRow(home));

  const addGroup = (label, items) => {
    if (!items.length) return;
    const g = document.createElement('div');
    g.className = 'groupLabel';
    g.textContent = label;
    nav.appendChild(g);
    items.forEach((s) => nav.appendChild(sourceRow(s)));
  };

  addGroup('SHUFFLE', mixes);
  addGroup('YOUR PLAYLISTS', mine);
  addGroup('LOCKED BY SPOTIFY', locked);

  if (locked.length) {
    const note = document.createElement('div');
    note.className = 'groupNote';
    note.textContent = 'Spotify only lets personal apps read playlists you own. Copy a locked playlist’s tracks into one of yours to shuffle it.';
    nav.appendChild(note);
  }

  const homeEl = document.querySelector('.source[data-key="home"]');
  if (homeEl && selectedKey === null) homeEl.classList.add('selected');
}

function sourceRow(s) {
  const div = document.createElement('div');
  div.className = 'source' + (s.locked ? ' locked' : '') + (selectedKey === s.key ? ' selected' : '');
  div.dataset.key = s.key;
  if (s.locked) div.title = 'Not readable by personal apps (Spotify Feb 2026 policy)';
  else if (s.hint) div.title = s.hint;
  else if (s.owner) div.title = `by ${s.owner}`;

  let icon;
  if (s.imageSmall && !s.locked) {
    icon = document.createElement('img');
    icon.src = s.imageSmall;
    icon.loading = 'lazy';
  } else {
    icon = document.createElement('span');
    icon.textContent = s.icon;
  }
  icon.classList.add('icon');

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = s.name;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = s.count || '';

  div.append(icon, name, count);
  if (s.type === 'home') div.addEventListener('click', () => mainView('home'));
  else if (!s.locked) div.addEventListener('click', () => selectSource(s));
  return div;
}

function renderHomeTiles(mine) {
  const grid = $('tileGrid');
  grid.innerHTML = '';

  const tiles = [
    { emoji: '💚', name: 'Liked Songs', meta: 'your saved tracks', onClick: () => selectSource(sources.find((s) => s.key === 'liked')) },
    ...mine.map((p) => ({
      image: p.imageLarge,
      emoji: '♪',
      name: p.name,
      meta: p.count ? `${p.count} tracks` : '',
      onClick: () => selectSource(p),
    })),
  ];

  for (const t of tiles) {
    const tile = document.createElement('div');
    tile.className = 'tile';

    if (t.image) {
      const img = document.createElement('img');
      img.className = 'tileArt';
      img.src = t.image;
      img.loading = 'lazy';
      tile.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'tileArt emoji';
      ph.textContent = t.emoji;
      tile.appendChild(ph);
    }

    const name = document.createElement('div');
    name.className = 'tileName';
    name.textContent = t.name;
    const meta = document.createElement('div');
    meta.className = 'tileMeta';
    meta.textContent = t.meta;
    tile.append(name, meta);
    tile.addEventListener('click', t.onClick);
    grid.appendChild(tile);
  }
}

$('heroEverything').addEventListener('click', () => {
  selectSource(sources.find((s) => s.key === 'library'));
});

// ---------- select source: one click = load + shuffle ----------
async function selectSource(src) {
  if (!src || loading) return;
  selectedKey = src.key;
  document.querySelectorAll('.source').forEach((el) => {
    el.classList.toggle('selected', el.dataset.key === src.key);
  });

  sourceLabel = src.name;
  $('srcTitle').textContent = src.name;
  $('srcMeta').textContent = '';

  const cover = $('srcCover');
  cover.style.backgroundImage = src.imageLarge ? `url("${src.imageLarge}")` : '';
  cover.textContent = src.imageLarge ? '' : (src.icon === '♪' ? '🎵' : src.icon || '🎵');

  mainView('loading');
  $('loadingMsg').textContent = 'Loading…';
  setActionsEnabled(false);

  try {
    const res = await invoke('data:tracks', { type: src.type, id: src.id, label: `"${src.name}"` });
    rawTracks = res.tracks;
    if (!rawTracks.length) {
      mainView('home');
      toast('No tracks found in that selection.', true);
      return;
    }
    const total = fmtTotal(rawTracks);
    let meta = `${rawTracks.length} tracks${total ? ' · ' + total : ''} · truly random order`;
    if (res.skipped && res.skipped.length) meta += ` · skipped ${res.skipped.length} unreadable`;
    $('srcMeta').textContent = meta;
    reshuffle();
    setActionsEnabled(true);
  } catch (e) {
    mainView('home');
    toast(e.message, true, 6000);
  }
}

function setActionsEnabled(on) {
  $('playBtn').disabled = !on;
  $('saveBtn').disabled = !on;
  $('reshuffleBtn').disabled = !on;
}

// ---------- shuffle + render ----------
function reshuffle() {
  shuffled = window.api.shuffle(rawTracks, { avoidRepeatArtists: $('spaceArtists').checked });
  const list = $('trackList');
  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  shuffled.slice(0, MAX_RENDER).forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'trackRow';

    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = i + 1;

    let art;
    if (t.art) {
      art = document.createElement('img');
      art.className = 'trackArt';
      art.src = t.art;
      art.loading = 'lazy';
    } else {
      art = document.createElement('div');
      art.className = 'trackArt ph';
      art.textContent = '♪';
    }

    const text = document.createElement('div');
    text.className = 'trackText';
    const title = document.createElement('div');
    title.className = 't';
    title.textContent = t.name;
    const artist = document.createElement('div');
    artist.className = 'a';
    artist.textContent = t.artist;
    text.append(title, artist);

    const dur = document.createElement('span');
    dur.className = 'd';
    dur.textContent = fmtDuration(t.durationMs);

    row.append(n, art, text, dur);
    frag.appendChild(row);
  });

  if (shuffled.length > MAX_RENDER) {
    const row = document.createElement('div');
    row.className = 'trackRow more';
    row.textContent = `… and ${shuffled.length - MAX_RENDER} more, all shuffled`;
    frag.appendChild(row);
  }

  list.appendChild(frag);
  list.scrollTop = 0;
  mainView('list');
}

$('reshuffleBtn').addEventListener('click', reshuffle);
$('spaceArtists').addEventListener('change', () => rawTracks.length && reshuffle());

// ---------- devices + play ----------
async function refreshDevices() {
  try {
    const data = await invoke('player:devices');
    const sel = $('deviceSelect');
    sel.innerHTML = '';
    const devices = (data && data.devices) || [];
    if (!devices.length) {
      sel.appendChild(new Option('no devices — open Spotify somewhere', ''));
    } else {
      devices.forEach((d) => {
        const opt = new Option(`${d.name}${d.is_active ? ' · active' : ''}`, d.id);
        if (d.is_active) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  } catch { /* best-effort */ }
}
$('refreshDevices').addEventListener('click', refreshDevices);

$('playBtn').addEventListener('click', async () => {
  const btn = $('playBtn');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
    const { count } = await invoke('player:play', {
      uris: shuffled.map((t) => t.uri),
      deviceId: $('deviceSelect').value || null,
    });
    toast(`▶ Playing ${count} tracks in truly random order`);
  } catch (e) {
    toast(e.message, true, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Play Now';
  }
});

// ---------- save modal ----------
$('saveBtn').addEventListener('click', () => {
  $('playlistName').value = `${sourceLabel} — true shuffle`;
  $('saveModal').classList.remove('hidden');
  $('playlistName').focus();
});

$('saveConfirmBtn').addEventListener('click', async () => {
  const btn = $('saveConfirmBtn');
  btn.disabled = true;
  try {
    const name = $('playlistName').value.trim() || `${sourceLabel} — true shuffle`;
    const { url, count } = await invoke('playlist:save', { name, uris: shuffled.map((t) => t.uri) });
    $('saveModal').classList.add('hidden');
    toast(`Saved "${name}" (${count} tracks). Play it with shuffle OFF.`, false, 5000);
    if (url) invoke('shell:open', url);
  } catch (e) {
    toast(e.message, true, 6000);
  } finally {
    btn.disabled = false;
  }
});

// ---------- settings modal ----------
$('settingsBtn').addEventListener('click', () => {
  setStatus('settingsStatus', '');
  $('settingsModal').classList.remove('hidden');
});

$('settingsSaveBtn').addEventListener('click', async () => {
  const btn = $('settingsSaveBtn');
  btn.disabled = true;
  try {
    await invoke('settings:set', {
      clientId: $('clientId').value,
      redirectUri: $('redirectUri').value,
    });
    setStatus('settingsStatus', 'Approve the request in your browser…');
    const { user } = await invoke('auth:connect');
    $('settingsModal').classList.add('hidden');
    enterApp(user);
    toast(`Connected as ${user}`);
  } catch (e) {
    setStatus('settingsStatus', e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await invoke('auth:logout');
  location.reload();
});

// close modals on backdrop / cancel / Escape
document.querySelectorAll('.modalWrap').forEach((wrap) => {
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.hasAttribute('data-close')) wrap.classList.add('hidden');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modalWrap').forEach((w) => w.classList.add('hidden'));
  if (e.key === 'Enter' && !$('saveModal').classList.contains('hidden')) $('saveConfirmBtn').click();
});

init().catch((e) => {
  show('onboarding');
  setStatus('obStatus', e.message, 'err');
});
