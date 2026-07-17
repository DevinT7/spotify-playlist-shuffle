'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const { trueShuffle } = require('./shared/shuffle');

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, args) => ipcRenderer.invoke(channel, args),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, msg) => cb(msg)),
  shuffle: (tracks, opts) => trueShuffle(tracks, opts),
});
