'use strict';
// Spotify OAuth 2.0 Authorization Code + PKCE, done properly for a desktop app:
// - auth happens in the user's default browser (never inside the app)
// - a loopback HTTP server on 127.0.0.1 catches the redirect (any path works,
//   so an existing dashboard redirect URI like /true-shuffle.html is fine)
// - tokens are exchanged/refreshed in the main process and stored encrypted

const crypto = require('crypto');
const http = require('http');

const SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class Auth {
  constructor(settings, tokens) {
    this.settings = settings;
    this.tokens = tokens;
    this._server = null;
  }

  get clientId() {
    return this.settings.get('clientId', '');
  }

  get redirectUri() {
    return this.settings.get('redirectUri', 'http://127.0.0.1:8888/callback');
  }

  isConnected() {
    return Boolean(this.tokens.get('refresh_token'));
  }

  logout() {
    this.tokens.clear();
  }

  // Opens the browser, waits for the loopback redirect, exchanges the code.
  async connect(openExternal) {
    if (!this.clientId) throw new Error('Enter your Spotify Client ID first.');

    const url = new URL(this.redirectUri);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error('Redirect URI must use 127.0.0.1 (loopback). Example: http://127.0.0.1:8888/callback');
    }
    const port = Number(url.port || 80);

    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const codePromise = this._listen(port, state);

    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', this.redirectUri);
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('state', state);
    await openExternal(authUrl.toString());

    const code = await codePromise;
    await this._exchange(code, verifier);
    return true;
  }

  _listen(port, expectedState) {
    this._closeServer();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._closeServer();
        reject(new Error('Timed out waiting for Spotify authorization (5 min).'));
      }, AUTH_TIMEOUT_MS);

      this._server = http.createServer((req, res) => {
        const u = new URL(req.url, `http://127.0.0.1:${port}`);
        const code = u.searchParams.get('code');
        const error = u.searchParams.get('error');
        const state = u.searchParams.get('state');
        if (!code && !error) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<body style="background:#0b0f0d;color:#7ee2a8;font-family:monospace;display:grid;place-items:center;height:100vh;margin:0">' +
          `<div>${error ? 'Authorization failed: ' + error : 'Connected! You can close this tab and return to True Shuffle.'}</div></body>`
        );
        clearTimeout(timer);
        this._closeServer();
        if (error) return reject(new Error('Spotify authorization failed: ' + error));
        if (state !== expectedState) return reject(new Error('OAuth state mismatch — try connecting again.'));
        resolve(code);
      });

      this._server.on('error', (e) => {
        clearTimeout(timer);
        reject(e.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use. Close the other app or change the redirect URI port.`)
          : e);
      });
      this._server.listen(port, '127.0.0.1');
    });
  }

  _closeServer() {
    if (this._server) {
      try { this._server.close(); } catch { /* noop */ }
      this._server = null;
    }
  }

  async _tokenRequest(params) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Token request failed: ${data.error_description || data.error || res.status}`);
    }
    this.tokens.setMany({
      access_token: data.access_token,
      refresh_token: data.refresh_token || this.tokens.get('refresh_token'),
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    });
    return data.access_token;
  }

  _exchange(code, verifier) {
    return this._tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: verifier,
    });
  }

  async refresh() {
    const refreshToken = this.tokens.get('refresh_token');
    if (!refreshToken) throw new Error('Not connected to Spotify.');
    return this._tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
    });
  }

  // Valid access token, refreshing if it expires within 60s.
  async getAccessToken() {
    const token = this.tokens.get('access_token');
    const expiresAt = this.tokens.get('expires_at', 0);
    if (token && Date.now() < expiresAt - 60_000) return token;
    return this.refresh();
  }
}

module.exports = { Auth, SCOPES };
