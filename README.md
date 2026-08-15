# Audio

A mobile-first, installable signal generator for `audio.miernicki.com`. The app is a fully static Vite build and uses the Web Audio API in the browser.

See [`AGENTS.md`](./AGENTS.md) for the complete implementation architecture, design system, Pixel 7 Pro fullscreen target, testing matrix, and maintenance procedures.

## Development

```sh
npm install
./dev.sh
```

The script prints a clickable local URL and keeps the Vite server alive until you press Control-C. Use `AUDIO_DEV_HOST` or `AUDIO_DEV_PORT` to override its `127.0.0.1:5173` defaults. `npm run dev` remains available when direct Vite output is preferred.

Create a production build with:

```sh
npm run build
npm run preview
```

## Deployment

The GitHub Actions workflow publishes `dist/` to GitHub Pages after every push to `main`. The `public/CNAME` file configures the custom domain. In the repository settings, set **Pages → Source** to **GitHub Actions**, and point the domain's DNS record at GitHub Pages.

## Installation and storage

The web app manifest requests portrait, fullscreen display when installed. Chrome on Android can install the app without a service worker; this project intentionally has no offline cache. Synth settings are retained in `localStorage` on the same origin.
