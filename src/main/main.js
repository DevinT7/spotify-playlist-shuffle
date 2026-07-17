'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('./store');
const { Auth } = require('./auth');
const Spotify = require('./spotify');

const settings = new Store('settings.json');
const tokens = new Store('tokens.json', { encrypted: true });
const auth = new Auth(settings, tokens);

let win = null;
const sendProgress = (message) => {
  if (win && !win.isDestroyed()) win.webContents.send('progress', message);
};
const spotify = new Spotify(auth, sendProgress);

function createWindow() {
  win = new BrowserWindow({
    width: 1060,
    height: 700,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#0b0f0d',
    title: 'True Shuffle',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs require() for the shared shuffle module
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---- IPC ----
const handle = (channel, fn) =>
  ipcMain.handle(channel, async (_e, args) => {
    try {
      return { ok: true, data: await fn(args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

handle('settings:get', () => ({
  clientId: settings.get('clientId', ''),
  redirectUri: settings.get('redirectUri', 'http://127.0.0.1:8888/callback'),
}));

handle('settings:set', ({ clientId, redirectUri }) => {
  settings.setMany({ clientId: clientId.trim(), redirectUri: redirectUri.trim() });
});

handle('auth:status', async () => {
  if (!auth.isConnected()) return { connected: false };
  try {
    const me = await spotify.getMe();
    return { connected: true, user: me.display_name || me.id };
  } catch {
    return { connected: false };
  }
});

handle('auth:connect', async () => {
  await auth.connect((url) => shell.openExternal(url));
  const me = await spotify.getMe();
  return { user: me.display_name || me.id };
});

handle('auth:logout', () => auth.logout());

handle('data:playlists', async () => {
  const data = await spotify.getPlaylists();
  // hide the app's internal rolling queue playlist from the picker
  const qid = settings.get('queuePlaylistId');
  if (qid) data.playlists = data.playlists.filter((p) => p.id !== qid);
  return data;
});

handle('data:tracks', async ({ type, id, label }) => {
  if (type === 'liked') return { tracks: await spotify.getLikedTracks() };
  if (type === 'library') return spotify.getWholeLibrary(settings.get('queuePlaylistId'));
  return { tracks: await spotify.getPlaylistTracks(id, label) };
});

handle('player:devices', () => spotify.getDevices());

handle('player:play', ({ uris, deviceId }) => spotify.playNow(uris, deviceId, settings));

handle('playlist:save', ({ name, uris }) => spotify.saveAsPlaylist(name, uris));

handle('playlist:copy', ({ id, name, owner }) => spotify.copyLockedPlaylist(id, name, owner));

handle('shell:open', (url) => shell.openExternal(url));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
