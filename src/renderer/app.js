'use strict';
const $ = (id) => document.getElementById(id);

let sources = [];        // [{type, id, name, meta, locked, icon}]
let selected = null;
let rawTracks = [];
let shuffled = [];
let sourceLabel = '';

const setStatus = (id, msg, cls = '') => {
  const el = $(id);
  el.textContent = msg || '';
  el.className = 'status' + (cls ? ' ' + cls : '');
};

const invoke = async (channel, args) => {
  const res = await window.api.invoke(channel, args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

window.api.onProgress((msg) => setStatus('sourceStatus', msg));

// ---------- connect ----------
async function init() {
  const s = await invoke('settings:get');
  $('clientId').value = s.clientId;
  $('redirectUri').value = s.redirectUri;

  const st = await invoke('auth:status');
  if (st.connected) onConnected(st.user);
}

function onConnected(user) {
  $('connectBadge').textContent = '✓';
  $('connectBadge').classList.add('ok');
  $('logoutBtn').classList.remove('hidden');
  $('connectBtn').textContent = 'Reconnect';
  setStatus('connectStatus', `Connected as ${user}.`, 'ok');
  loadSources();
}

$('connectBtn').addEventListener('click', async () => {
  const btn = $('connectBtn');
  btn.disabled = true;
  try {
    await invoke('settings:set', {
      clientId: $('clientId').value,
      redirectUri: $('redirectUri').value,
    });
    setStatus('connectStatus', 'Waiting for you to approve in the browser…');
    const { user } = await invoke('auth:connect');
    onConnected(user);
  } catch (e) {
    setStatus('connectStatus', e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await invoke('auth:logout');
  location.reload();
});

// ---------- sources ----------
async function loadSources() {
  setStatus('sourceStatus', 'Loading your playlists…');
  $('sourceCard').classList.remove('hidden');
  try {
    const { playlists } = await invoke('data:playlists');
    sources = [
      { type: 'library', id: null, name: 'Everything (DJ replacement)', meta: 'liked songs + all your playlists, deduped', icon: '🎧', locked: false },
      { type: 'liked', id: null, name: 'Liked Songs', meta: '', icon: '💚', locked: false },
      ...playlists.map((p) => ({
        type: 'playlist',
        id: p.id,
        name: p.name,
        meta: `by ${p.owner}${p.total != null ? ' · ' + p.total + ' tracks' : ''}`,
        icon: p.readable ? '🎵' : '🔒',
        locked: !p.readable,
      })),
    ];
    renderSources();
    const lockedCount = playlists.filter((p) => !p.readable).length;
    $('lockedHint').textContent = lockedCount
      ? `🔒 ${lockedCount} playlist(s) are locked: since Feb 2026, Spotify only lets personal apps read playlists you own or collaborate on. Workaround: select-all in that playlist in Spotify and copy the tracks into a playlist of your own.`
      : '';
    setStatus('sourceStatus', '');
  } catch (e) {
    setStatus('sourceStatus', e.message, 'err');
  }
}

function renderSources() {
  const list = $('sourceList');
  list.innerHTML = '';
  sources.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'source' + (s.locked ? ' locked' : '') + (selected === i ? ' selected' : '');
    div.title = s.locked ? 'Not readable by personal apps (Spotify Feb 2026 policy)' : '';

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = s.icon;
    const name = document.createElement('span');
    name.textContent = s.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = s.meta;

    div.append(icon, name, meta);
    if (!s.locked) {
      div.addEventListener('click', () => {
        selected = i;
        renderSources();
      });
    }
    list.appendChild(div);
  });
}

// ---------- load + shuffle ----------
$('loadBtn').addEventListener('click', async () => {
  if (selected == null) {
    setStatus('sourceStatus', 'Pick a source first.', 'err');
    return;
  }
  const src = sources[selected];
  const btn = $('loadBtn');
  btn.disabled = true;
  try {
    const res = await invoke('data:tracks', { type: src.type, id: src.id, label: `"${src.name}"` });
    rawTracks = res.tracks;
    sourceLabel = src.name;
    if (!rawTracks.length) {
      setStatus('sourceStatus', 'No tracks found in that selection.', 'err');
      return;
    }
    let msg = `Loaded ${rawTracks.length} tracks from "${src.name}".`;
    if (res.skipped && res.skipped.length) msg += ` (skipped: ${res.skipped.join(', ')})`;
    setStatus('sourceStatus', msg, 'ok');
    reshuffle();
    $('reshuffleBtn').classList.remove('hidden');
    $('resultCard').classList.remove('hidden');
    $('playlistName').value = `${src.name} — true shuffle`;
    refreshDevices();
  } catch (e) {
    setStatus('sourceStatus', e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

$('reshuffleBtn').addEventListener('click', reshuffle);
$('spaceArtists').addEventListener('change', () => rawTracks.length && reshuffle());

function reshuffle() {
  shuffled = window.api.shuffle(rawTracks, { avoidRepeatArtists: $('spaceArtists').checked });
  $('resultSummary').textContent = `${shuffled.length} tracks · truly random order`;
  const ol = $('preview');
  ol.innerHTML = '';
  shuffled.slice(0, 25).forEach((t) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 't';
    name.textContent = t.name;
    li.appendChild(name);
    li.appendChild(document.createTextNode(` — ${t.artist}`));
    ol.appendChild(li);
  });
  if (shuffled.length > 25) {
    const li = document.createElement('li');
    li.textContent = `… and ${shuffled.length - 25} more`;
    ol.appendChild(li);
  }
  setStatus('resultStatus', '');
}

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
      devices.forEach((d) =>
        sel.appendChild(new Option(`${d.name}${d.is_active ? ' (active)' : ''}`, d.id))
      );
    }
  } catch { /* device list is best-effort */ }
}
$('refreshDevices').addEventListener('click', refreshDevices);

$('playBtn').addEventListener('click', async () => {
  const btn = $('playBtn');
  btn.disabled = true;
  try {
    const { count } = await invoke('player:play', {
      uris: shuffled.map((t) => t.uri),
      deviceId: $('deviceSelect').value || null,
    });
    setStatus('resultStatus', `▶ Playing ${count} tracks in truly random order.`, 'ok');
  } catch (e) {
    setStatus('resultStatus', e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

// ---------- save ----------
$('saveBtn').addEventListener('click', async () => {
  const btn = $('saveBtn');
  btn.disabled = true;
  try {
    const name = $('playlistName').value.trim() || `${sourceLabel} — true shuffle`;
    const { url, count } = await invoke('playlist:save', {
      name,
      uris: shuffled.map((t) => t.uri),
    });
    setStatus('resultStatus', `Saved "${name}" (${count} tracks). Play it with shuffle OFF.`, 'ok');
    if (url) invoke('shell:open', url);
  } catch (e) {
    setStatus('resultStatus', e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

init().catch((e) => setStatus('connectStatus', e.message, 'err'));
