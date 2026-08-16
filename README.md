# Audio

A mobile-first, installable signal generator for `audio.miernicki.com`. The fully static Vite app uses a normalized nine-voice Web Audio oscillator bank with adjustable center frequency and total frequency spread.

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

The web app manifest requests portrait, fullscreen display when installed. In an eligible Chrome session, installation is offered through a bottom Install/Cancel notice rather than a permanent control. Chrome on Android can install the app without a service worker; this project intentionally has no offline cache. Synth settings are retained in `localStorage` on the same origin.

## Accessible controls

The app uses one permanent dark, high-contrast presentation with large controls and an adaptive, non-animated full-bleed waveform bundle above a text-only SINE/SQUARE/TRIANGLE selector. One sharp center trace preserves the selected shape while eight faint traces separate as spread increases; a dark knockout keeps the center readable without implying that greater spread increases volume. The synthesis stage's top row is split into two half-width non-editable readouts: center frequency with `Hz` on the left and total spread with `SEMITONES` on the right. Below, center frequency, a Play/INVERT/Help stack, and spread occupy equal thirds. The `?` button opens a full-screen white Help dialog with black text, a permanently visible scrollbar, and detailed sections about frequency generation and semitone voice placement; opening it pauses the tone. Frequency is logarithmic from 20–20,000 Hz; spread is linear from 0–48 total semitones and distributes nine normalized voices symmetrically around the center. One semitone is one twelfth of an octave, and the displayed spread is the complete interval between the lowest and highest outer voices. Both vertical sliders use solid orange circular thumbs without concentric rings. Stereo position has uppercase LEFT, CENTER, and RIGHT presets in addition to its fine-position slider; preset presses glide the fader and audio pan to their destination over half a second unless reduced motion is requested. The app remains a fixed one-screen instrument at supported phone sizes, while very short or browser-zoomed layouts can reflow vertically without horizontal overflow. Browser zoom is not blocked.
