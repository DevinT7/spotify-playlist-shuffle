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

// ---------- toast ----------
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

window.api.onProgress((msg) => {
  if (loading) $('loadingMsg').textContent = msg;
});

// ---------- view switching ----------
function show(view) {
  $('onboarding').classList.toggle('hidden', view !== 'onboarding');
  $('app').classList.toggle('hidden', view !== 'app');
}

function trackView(state) {
  $('emptyState').classList.toggle('hidden', state !== 'empty');
  $('loadingState').classList.toggle('hidden', state !== 'loading');
  $('trackList').classList.toggle('hidden', state !== 'list');
  loading = state === 'loading';
}

// ---------- init ----------
async function init() {
  const s = await invoke('settings:get');
  for (const id of ['obClientId', 'clientId']) $(id).value = s.clientId;
  for (const id of ['obRedirectUri', 'redirectUri']) $(id).value = s.redirectUri;

  const st = await invoke('auth:status');
  if (st.connected) {
    enterApp(st.user);
  } else {
    show('onboarding');
  }
}

async function enterApp(user) {
  show('app');
  $('userBox').textContent = `Connected as ${user}`;
  trackView('empty');
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

// ---------- sidebar sources ----------
async function loadSources() {
  try {
    const { playlists } = await invoke('data:playlists');
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
        count: p.total != null ? String(p.total) : '',
        locked: !p.readable,
        owner: p.owner,
      };
      (p.readable ? mine : locked).push(item);
    }
    sources = [...mixes, ...mine, ...locked];
    renderSources({ mixes, mine, locked });
  } catch (e) {
    toast(e.message, true, 6000);
  }
}

function renderSources({ mixes, mine, locked }) {
  const nav = $('sourceList');
  nav.innerHTML = '';

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
    note.className = 'groupLabel';
    note.style.letterSpacing = '0';
    note.style.textTransform = 'none';
    note.textContent = 'Spotify only lets personal apps read playlists you own. Copy a locked playlist’s tracks into one of yours to shuffle it.';
    nav.appendChild(note);
  }
}

function sourceRow(s) {
  const div = document.createElement('div');
  div.className = 'source' + (s.locked ? ' locked' : '') + (selectedKey === s.key ? ' selected' : '');
  div.dataset.key = s.key;
  if (s.locked) div.title = 'Not readable by personal apps (Spotify Feb 2026 policy)';
  else if (s.hint) div.title = s.hint;
  else if (s.owner) div.title = `by ${s.owner}`;

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = s.icon;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = s.name;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = s.count;

  div.append(icon, name, count);
  if (!s.locked) div.addEventListener('click', () => selectSource(s));
  return div;
}

// one click = load + shuffle
async function selectSource(src) {
  if (loading) return;
  selectedKey = src.key;
  document.querySelectorAll('.source').forEach((el) => {
    el.classList.toggle('selected', el.dataset.key === src.key);
  });

  sourceLabel = src.name;
  $('srcTitle').textContent = src.name;
  $('srcMeta').textContent = '';
  trackView('loading');
  $('loadingMsg').textContent = 'Loading…';
  setActionsEnabled(false);

  try {
    const res = await invoke('data:tracks', { type: src.type, id: src.id, label: `"${src.name}"` });
    rawTracks = res.tracks;
    if (!rawTracks.length) {
      trackView('empty');
      $('srcMeta').textContent = 'no tracks found';
      toast('No tracks found in that selection.', true);
      return;
    }
    let meta = `${rawTracks.length} tracks · truly random order`;
    if (res.skipped && res.skipped.length) meta += ` · skipped ${res.skipped.length} unreadable`;
    $('srcMeta').textContent = meta;
    reshuffle();
    setActionsEnabled(true);
  } catch (e) {
    trackView('empty');
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
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = t.name;
    const artist = document.createElement('span');
    artist.className = 'a';
    artist.textContent = t.artist;
    row.append(n, title, artist);
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
  trackView('list');
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
