# 🎲 True Shuffle

A desktop app that gives you a **truly random** Spotify shuffle. Spotify's shuffle and DJ are algorithmically weighted, which is why the same songs keep surfacing. True Shuffle pulls your music, shuffles it with an unbiased Fisher-Yates algorithm (crypto randomness, every permutation equally likely), and either **plays it instantly** or **saves it as a playlist**.

## Features

**Instant play** writes the shuffled order into a hidden, reusable "🎲 True Shuffle Queue" playlist, forces Spotify's own shuffle OFF, and starts playback on whichever device you pick (requires Premium).

**Save as playlist** creates a new private playlist in truly random order — play it top-to-bottom with shuffle off.

**DJ replacement mode** ("Everything") merges your Liked Songs and every playlist you own, dedupes, and shuffles the whole library — a random mix instead of Spotify's repetitive DJ.

**Artist spacing** (optional, on by default) avoids the same artist twice in a row while staying random.

## Setup (one time)

1. **Install** — requires [Node.js](https://nodejs.org). In this folder:
   ```
   npm install
   ```
2. **Spotify app credentials** — go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) (you can reuse the app you already created):
   - Add a Redirect URI of exactly `http://127.0.0.1:8888/callback` (or keep your existing `http://127.0.0.1:8888/true-shuffle.html` — either works, the app catches any path on that port)
   - Make sure **Web API** is checked, and your Spotify account is added under **User Management**
   - Copy the **Client ID**
3. **Run**:
   ```
   npm start
   ```
   Paste the Client ID, set the Redirect URI to the same value as the dashboard, hit **Connect Spotify**, and approve in the browser.

## Everyday use

```
npm start
```

Pick a source → **Load & Shuffle** → **Play Now** (or save as a playlist). Re-shuffle any time for a fresh order.

To build a standalone installable app (no terminal needed afterwards):

```
npm run dist
```

The installer lands in `dist/`.

## Why some playlists show a 🔒

Since Spotify's **February 2026 Dev Mode changes** (enforced March 9, 2026), personal API apps can only read the tracks of playlists you **own or collaborate on**. Playlists made by other accounts (e.g. "by Playlistor") return metadata only — that's also why the old version of this tool got `403 Forbidden`. Workaround: in Spotify, select all tracks in that playlist and copy them into a playlist of your own; it'll then be shuffleable here.

Other 2026 API changes this app already accounts for: `/playlists/{id}/tracks` → `/playlists/{id}/items`, playlist creation via `POST /me/playlists`, and the `tracks`→`items` / `track`→`item` field renames.

## How it works

```
src/
├── main/          Electron main process
│   ├── main.js    window + IPC wiring
│   ├── auth.js    OAuth PKCE in your browser + loopback callback server; tokens stored OS-encrypted
│   ├── spotify.js Web API client (2026 endpoints, pagination, rate-limit retry)
│   └── store.js   tiny JSON persistence (settings + encrypted tokens)
├── shared/
│   └── shuffle.js Fisher-Yates with crypto randomness + rejection sampling, artist spacing
└── renderer/      the UI
```

Run the shuffle-engine tests with `npm test`.

Your tokens and music data never leave your machine — the app talks only to `accounts.spotify.com` and `api.spotify.com`.
