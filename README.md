# Echo Atlas

A single-page music discovery demo. The full-window Three.js map shows artists, songs, playlists, and their links. Use the toolbar to manage playlists and play or pause a generated synth preview. Playlist changes are saved in the browser's local storage.

## Run locally

Serve this folder with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Three.js and fonts load from CDNs, so the 3D view needs an internet connection. There is no build step or package installation.

## Test the model

With Node.js 20 or later:

```sh
npm test
```

The tests use Node's built-in test runner and have no package dependencies.
