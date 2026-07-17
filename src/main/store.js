'use strict';
// Tiny JSON persistence in Electron's userData dir.
// With { encrypted: true } values are encrypted via safeStorage (OS keychain)
// when available — used for OAuth tokens.

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

class Store {
  constructor(filename, { encrypted = false } = {}) {
    this.filename = filename;
    this.encrypted = encrypted;
    this._data = null;
  }

  get _file() {
    return path.join(app.getPath('userData'), this.filename);
  }

  _load() {
    if (this._data) return this._data;
    try {
      const raw = fs.readFileSync(this._file);
      if (this.encrypted && safeStorage.isEncryptionAvailable()) {
        const parsed = JSON.parse(raw.toString('utf8'));
        if (parsed.__enc) {
          this._data = JSON.parse(safeStorage.decryptString(Buffer.from(parsed.__enc, 'base64')));
          return this._data;
        }
      }
      this._data = JSON.parse(raw.toString('utf8'));
    } catch {
      this._data = {};
    }
    return this._data;
  }

  _save() {
    let out;
    if (this.encrypted && safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(JSON.stringify(this._data)).toString('base64');
      out = JSON.stringify({ __enc: enc });
    } else {
      out = JSON.stringify(this._data, null, 2);
    }
    fs.mkdirSync(path.dirname(this._file), { recursive: true });
    fs.writeFileSync(this._file, out, { mode: 0o600 });
  }

  get(key, fallback = undefined) {
    const v = this._load()[key];
    return v === undefined ? fallback : v;
  }

  set(key, value) {
    this._load()[key] = value;
    this._save();
  }

  setMany(obj) {
    Object.assign(this._load(), obj);
    this._save();
  }

  all() {
    return { ...this._load() };
  }

  clear() {
    this._data = {};
    this._save();
  }
}

module.exports = Store;
