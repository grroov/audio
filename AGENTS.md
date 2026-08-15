# Audio project handbook

This file applies to the entire repository. It is both the implementation reference and the maintenance contract for agents and contributors working on `audio.miernicki.com`.

## Product definition

Audio is a mobile-only, single-screen signal generator delivered as an installable Progressive Web App. Its primary target is Chrome on Android, with the installed fullscreen experience on a Google Pixel 7 Pro treated as the reference layout.

The application must remain:

- fully static after `npm run build`;
- deployable from `dist/` to GitHub Pages at `https://audio.miernicki.com/`;
- usable without a server, API, account, database, analytics, or telemetry;
- portrait-first and non-scrollable;
- installable with a Web App Manifest;
- online-only, with no service worker unless offline behavior becomes an explicit product requirement;
- silent until the user presses Start;
- persistent for user control settings, but never persistent for the playing/stopped state.

The current product surface is intentionally narrow: one oscillator, three waveforms, frequency, polarity inversion, stereo position, and power. Do not introduce unrelated features while making maintenance changes.

## Platform and architecture

### Runtime

The shipped application is browser-native TypeScript, HTML, and CSS. Vite bundles it into static files. All synthesis happens locally through the Web Audio API.

There is no Python runtime. The original “Python/Vite” description is interpreted as a static Vite application because GitHub Pages cannot run Python. Python may be used for an optional build-time utility in the future, but it must not become a production server dependency or prevent the final output from remaining static.

### Toolchain

- Node.js 22 is the deployment runtime used by GitHub Actions.
- Vite is the static development server and production bundler.
- TypeScript runs in strict, no-emit checking mode before every production build.
- No UI framework is used. Preserve the small vanilla DOM implementation unless a concrete requirement justifies the cost of a framework.
- `package-lock.json` is authoritative and must remain committed.

Current commands:

```sh
npm install
./dev.sh
npm run dev
npm run check
npm run build
npm run preview
```

`npm run build` is the minimum required verification for every code or styling change. It runs `tsc --noEmit` before Vite.

### File map

- `index.html`: complete semantic interface, PWA meta tags, inline waveform glyphs, and the Vite entry point.
- `dev.sh`: preferred local launcher; prints the app URL, owns the Vite process, and shuts it down on Control-C.
- `src/main.ts`: settings validation, UI rendering, Web Audio graph, event handling, installation flow, and installed-mode detection.
- `src/styles.css`: the complete visual system, fixed viewport layout, responsive height rules, safe-area handling, and control styling.
- `src/vite-env.d.ts`: Vite client types.
- `public/manifest.webmanifest`: install metadata and fullscreen/portrait behavior.
- `public/favicon.svg`: browser favicon.
- `public/icon-source.svg`: editable master artwork for application icons.
- `public/icons/`: raster install and Apple touch icons.
- `public/CNAME`: GitHub Pages custom domain; it must continue to contain `audio.miernicki.com`.
- `public/.nojekyll`: prevents GitHub Pages from applying Jekyll processing.
- `vite.config.ts`: root-domain static build configuration.
- `.github/workflows/deploy.yml`: GitHub Pages build and deployment workflow.
- `README.md`: short human onboarding guide. This file, `AGENTS.md`, is the detailed source of truth.
- `dist/`: generated output. Never edit it by hand. Recreate it with `npm run build`.
- `notes`: user-owned scratch file. Do not remove or repurpose it without an explicit request.

### Development launcher

Run `./dev.sh` after `npm install`. It binds Vite to `127.0.0.1:5173`, prints `http://127.0.0.1:5173/` as a terminal-clickable URL, and remains in a lightweight loop for as long as the server process is alive. Control-C exits the loop and terminates the exact Vite child process before the script returns.

Optional environment overrides:

```sh
AUDIO_DEV_HOST=0.0.0.0 AUDIO_DEV_PORT=4173 ./dev.sh
```

When binding to `0.0.0.0` or `::`, the displayed local link uses `localhost`; Vite also reports any available network URL. The script uses `--strictPort`, so it fails clearly instead of silently choosing a different URL when the requested port is occupied. Keep Vite as a directly managed child rather than wrapping it in a background `npm` process, or Control-C cleanup may leave an orphaned server.

## Interface anatomy

The order of controls is deliberate and must be maintained unless the product changes:

1. Header: Audio wordmark, install action in browser mode, and Start/Stop control.
2. Monitor: Ready/Live state, nearest musical note, representative waveform, and frequency readout.
3. Three-way waveform selector: Sine, Square, Triangle.
4. Frequency stage: logarithmic vertical frequency slider and polarity switch.
5. Bottom control: horizontal stereo-position slider.
6. Low-volume reminder, when the viewport is tall enough.
7. A transient live-region toast overlays the bottom without changing layout.

The page has no routes and no content below the fold. The shell is fixed to the viewport and `body` is not scrollable. Any new feature must fit without making the page scroll. On constrained heights, reduce ornamental spacing or hide secondary copy before shrinking core controls.

## Audio implementation

### Signal chain

The graph is created lazily after a user gesture:

```text
OscillatorNode
  -> polarity GainNode (+1 normal, -1 inverted)
  -> StereoPannerNode (-1 left through 0 center to +1 right)
  -> master GainNode (click-free start/stop envelope)
  -> AudioContext.destination
```

Important invariants:

- Never autoplay. `AudioContext` creation/resume must remain downstream of pressing Start.
- Keep output conservative. `OUTPUT_LEVEL` is currently `0.14`; increasing it requires an explicit product decision and physical listening tests beginning at low device volume.
- The master output ramps to the target over 45 ms and ramps to zero over 40 ms to avoid clicks.
- Frequency and pan use `setTargetAtTime` with a 12 ms time constant.
- Polarity crosses between +1 and -1 with a 25 ms linear ramp.
- The oscillator is started once when the graph is created. Stop silences the gain and suspends the context rather than destroying the graph.
- The app automatically stops when the document becomes hidden. A sustained test tone must not continue accidentally after the user leaves the app.
- Playing state is session-only and always initializes as stopped.
- The app does not request microphone access. It generates output only.

### Waveforms

The supported waveform union is:

```ts
type Waveform = "sine" | "square" | "triangle";
```

These names map directly to `OscillatorNode.type`. The scope drawing is representative rather than a sampled analyser output. `WAVE_PATHS` in `src/main.ts` controls the monitor drawing; the smaller selector glyphs live inline in `index.html`.

When adding a waveform, update all of the following together:

1. the `Waveform` union;
2. `isWaveform` validation;
3. `WAVE_PATHS`;
4. the selector button and glyph in `index.html`;
5. the segmented-control grid styling if the number of options changes;
6. persistence and reload testing;
7. physical listening tests for level and clicks.

### Frequency model

Frequency spans 20 Hz to 20,000 Hz. The native range control exposes integer values from 0 through 1,000, but the audio value is logarithmic so equal travel represents equal frequency ratios.

Forward mapping:

```text
frequency = 20 * (20000 / 20)^(slider / 1000)
```

Inverse mapping:

```text
slider = round(log(frequency / 20) / log(20000 / 20) * 1000)
```

Do not replace this with a linear frequency slider. A linear 20–20,000 Hz control would make the musically useful low-frequency range nearly impossible to select.

The note display uses equal temperament relative to A4 = 440 Hz and shows cent deviation from the nearest MIDI note. The note is informational; frequency remains the actual source of truth.

### Stereo position and inversion

The pan range in stored state is `-1` through `+1`; the HTML slider uses `-100` through `100`. `StereoPannerNode` supplies equal-power panning. At center, the mono oscillator feeds both channels. At either extreme, only the corresponding side remains.

Inversion multiplies the mono waveform by `-1` before panning. A single inverted oscillator sounds the same in isolation, but the phase relationship is materially different when combined with another signal. Preserve this control as a polarity operation, not a visual-only flag.

## Persistent state

Settings are stored in `localStorage` under:

```text
audio.miernicki.settings.v1
```

Schema:

```ts
interface SynthSettings {
  waveform: "sine" | "square" | "triangle";
  frequency: number; // clamped to 20..20000 Hz
  inverted: boolean;
  pan: number; // clamped to -1..1
}
```

Defaults are sine, 440 Hz, normal polarity, and centered pan. Loading treats stored data as untrusted: validate types, reject unknown waveform names, clamp numeric values, and fall back field-by-field. Storage failures are intentionally non-fatal.

For additive settings, keep parsing old partial objects and supply a default. For a breaking schema change, add an explicit migration or advance the versioned key. Do not store the live `AudioContext`, install-prompt object, playing state, or transient UI state.

Installed Chrome and ordinary Chrome share storage for the same origin. Clearing site data, using Incognito, or changing the origin will clear or isolate settings; that is expected.

## PWA and installation contract

`public/manifest.webmanifest` is configured with:

- root `id`, `start_url`, and `scope` for the custom domain;
- `display: "fullscreen"`;
- `display_override: ["fullscreen", "standalone"]`;
- portrait orientation;
- matching dark theme and background colors;
- 192 px, 512 px, and maskable 512 px PNG icons;
- `prefer_related_applications: false`.

Chrome's `beforeinstallprompt` event is captured and deferred. The visible Install button invokes it when available; otherwise it explains the Chrome “Add to Home screen” menu path. `appinstalled` hides the button. Installed-mode media queries and JavaScript detection must hide the Install control immediately when launched from the home screen.

No service worker is present by design. Current Chrome on Android does not require a service-worker fetch handler for installation, and this product explicitly does not promise offline use. Do not add a pass-through or empty service worker. Add one only if the product adopts an offline/cache/update strategy, and then document cache versioning, invalidation, update UX, and failure recovery here.

Installation requires production HTTPS. GitHub Pages supplies HTTPS once DNS and Pages configuration are correct.

## Pixel 7 Pro fullscreen target

The physical Pixel 7 Pro display is 1440 × 3120 with a 19.5:9 aspect ratio. CSS viewport dimensions vary with Android display scaling, browser version, and system insets, so never branch on device pixel ratio or user agent.

Use this responsive test envelope for the installed portrait experience:

- reference width: 412 CSS px;
- expected fullscreen height band: approximately 892–915 CSS px;
- reference aspect ratio: 19.5:9;
- regression widths: 320, 360, 390, and 412 CSS px;
- short-height regression: 568 and 640 CSS px.

Pixel/fullscreen rules:

- Use `100dvh` with a `100svh` fallback; do not use a fixed pixel height.
- Keep `viewport-fit=cover` and consume `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` at the shell edges.
- Hide browser-only installation UI in `fullscreen` and `standalone` display modes without waiting for JavaScript, preventing first-frame flash.
- Add an `.is-installed` root class from display-mode detection so installed-only tuning is testable and does not depend solely on CSS media support.
- Keep the power control in the upper-right thumb-accessible header position.
- Keep stereo position at the bottom, but above the bottom safe/gesture inset.
- Maintain at least a 48 × 48 CSS px interactive hit area for buttons and sliders on the reference device. A visual knob may be smaller if the input's actual box remains at least 48 px.
- Do not put controls under the centered hole-punch/cutout area. The current header leaves the center clear.
- Avoid pure-white full-screen backgrounds on the OLED display. The near-black palette is intentional.
- Optimize with width/height media queries, not a `Pixel 7 Pro` user-agent check.

## Visual design system

### Character

The app should feel like a precise pocket instrument: restrained, technical, dark, and immediately legible. It is not a generic dashboard. Use waveform geometry, calibrated labels, and a small number of strong states rather than decorative cards or illustrations.

### Palette

Canonical custom properties live in `:root`:

- `--ink: #f1f3eb`: primary text and knob centers;
- `--muted: #838a84`: secondary labels;
- `--faint: #626a65`: calibration marks and tertiary copy;
- `--panel: #101313`: base panel color;
- `--panel-raised: #151918`: selected control surface;
- `--line: rgba(218, 229, 220, 0.12)`: borders and rules;
- `--accent: #ff7043`: signal path, selected waveform glyph, and slider ring;
- `--accent-soft: rgba(255, 112, 67, 0.15)`: subtle selected fills;
- `--live: #b7f54a`: audio-live state only.

Do not use color alone to communicate state. Selected controls also change surface, text, position, `aria-checked`, or label copy. Reserve green for “audio is currently producing output.”

### Type

- Use system UI fonts for the wordmark and actions; there are no remote font requests.
- Use the system monospace stack for readings, calibration, and technical labels.
- Frequency digits use tabular numerals.
- Labels are uppercase with modest tracking.
- Do not reduce operational labels below the current compact-device floor. On the Pixel target, prefer roughly 10–12 CSS px for technical labels and larger type for actionable text.

### Geometry and spacing

- The maximum shell width is 520 px so desktop previews remain phone-shaped.
- Primary horizontal gutters are 18 px; compact screens use 13 px.
- Panels use subtle 1 px borders and approximately 12–13 px radii.
- The frequency stage consumes all flexible vertical space.
- The vertical track is visually narrow, but its range input owns a much wider touch area.
- The pan track has a visible center calibration mark.
- Avoid shadows except for shallow selected-state separation, knobs, the live output glow, and toast elevation.

### Motion and feedback

- Transitions should usually remain between 150 and 200 ms.
- Audio parameter automation, not CSS, prevents sound clicks.
- Playing animates the wordmark meter and scope dash; these animations are decorative.
- Respect `prefers-reduced-motion` by effectively disabling animations and transitions.
- Android haptic feedback is an optional 8 ms vibration. Functionality must not depend on vibration support.
- Use transient toast messages for install guidance, start-volume warning, and recoverable errors. Toasts must not alter layout.

## Interaction and accessibility

- Use semantic native buttons and range inputs.
- The three waveform buttons form a `radiogroup`, expose `aria-checked`, and support Left/Right arrow navigation with roving `tabIndex`.
- Polarity uses `role="switch"` and `aria-checked`.
- Power uses `aria-pressed` and swaps both its visible label and accessible label.
- Range controls update `aria-valuetext` to human-readable Hz and pan descriptions.
- The toast is a polite atomic live region.
- All meaningful SVGs used only for decoration are `aria-hidden`.
- Maintain visible `:focus-visible` outlines even though Android touch is the primary input.
- Never depend on hover.
- Keep `touch-action: none` on sliders so a drag changes the control instead of invoking browser movement. Buttons use manipulation semantics.
- Keep tap targets separated; expanding one target must not overlap another.
- Maintain WCAG-level contrast for small labels. Increasing `--faint` may be preferable to shrinking text if the interface becomes dense.
- Device zoom is currently disabled to protect the fixed instrument surface. Because that removes a browser accessibility mechanism, do not also reduce text or touch targets below their documented floors.

## Responsive behavior

The base CSS targets mainstream phones. Media-query priorities are:

1. installed `fullscreen`/`standalone`: hide Install immediately and apply safe-area-aware full-screen tuning;
2. Pixel/tall phone band (`min-width` around 390 px and `min-height` around 840 px): increase touch targets and use the available vertical track length;
3. compact width (`max-width: 370px`): reduce gutters and selector glyph size; hide only the visible Install text, never its accessible name;
4. compact height (`max-height: 720px`): shorten header/monitor/selector, reduce gaps, and hide the secondary volume reminder.

After any responsive change, prove `document.body.scrollWidth === innerWidth` and `document.body.scrollHeight === innerHeight` at the full regression matrix. A visually hidden or transformed element can still create overflow, so test computed dimensions rather than relying only on screenshots.

## Performance and privacy

- There are no runtime network requests after the page assets load.
- Do not add analytics, tracking, cookies, advertising, accounts, or third-party scripts without an explicit product requirement.
- Do not collect or transmit generated settings.
- Prefer inline/vector UI artwork and system fonts.
- Keep production output small. The initial baseline is approximately 120 KB total, including icons, and roughly 27 KB of HTML/CSS/JS before gzip. Investigate material growth.
- Animate only transforms, opacity, or simple SVG stroke properties where practical.
- Keep a single audio graph rather than allocating nodes on every slider input.

## Deployment

The workflow in `.github/workflows/deploy.yml` runs on pushes to `main` and manual dispatch:

1. check out source;
2. install Node 22 with npm caching;
3. configure GitHub Pages;
4. run `npm ci`;
5. run `npm run build`;
6. upload `dist/` as the Pages artifact;
7. deploy it to the `github-pages` environment.

Repository configuration outside source control must set **Settings → Pages → Source** to **GitHub Actions**. DNS for `audio.miernicki.com` must point to the chosen GitHub Pages site. Preserve `public/CNAME` so custom-domain configuration survives deployments.

The current working directory may not yet be a Git repository. Do not initialize, publish, or change a remote unless explicitly requested.

## Verification checklist

### Automated/local

Run after implementation changes:

```sh
npm run check
npm run build
npm audit
```

For layout work, serve the production build and test at least:

- 320 × 568;
- 360 × 640;
- 390 × 844;
- 412 × 892;
- 412 × 915.

For each size, verify:

- body and shell dimensions equal the viewport;
- no element crosses the left or right viewport edge;
- no scrollbars or pull-to-refresh movement;
- power, waveform, polarity, vertical slider, and pan remain reachable;
- selector labels do not wrap or clip;
- bottom pan control clears the safe area;
- browser mode shows Install and installed mode does not.

Automated interaction smoke tests should cover:

- each waveform selection updates `aria-checked`;
- frequency and pan inputs update their visible and accessible values;
- inversion updates the switch and representative scope;
- settings survive reload;
- Start enters the live UI state and Stop exits it;
- hiding the document stops playback;
- no console or page errors occur.

### Physical Pixel 7 Pro

Before a release that changes audio, manifest, or viewport behavior:

1. Open the HTTPS production site in current Chrome for Android.
2. Confirm the install action or Chrome menu installation succeeds.
3. Launch from the Android home screen and confirm there is no URL bar or browser chrome.
4. Confirm portrait startup, safe-area clearance, and no initial Install-button flash.
5. Begin with device volume low; test Start/Stop and listen for clicks.
6. Test sine, square, and triangle across low, middle, and high frequencies.
7. Test inversion while playing.
8. Use stereo headphones to verify center, full left, full right, and intermediate pan.
9. Change every setting, close the PWA, relaunch it, and confirm restoration while remaining stopped.
10. Send the app to the background while playing and confirm it stops.
11. Rotate the phone and confirm the installed app remains portrait or degrades without overflow if Android temporarily ignores the lock.

Do not perform high-frequency or high-volume physical tests through headphones for prolonged periods.

## Maintenance recipes

### Change styling

Edit `src/styles.css`, not generated assets in `dist/`. Keep state classes (`.is-playing`, `.is-active`, `.is-selected`, `.is-installed`) consistent with `src/main.ts`. Re-run the complete viewport matrix when changing grid rows, safe-area padding, slider sizes, or font metrics.

### Change settings

Update the TypeScript interface, defaults, loader validation, renderer, event listener, and this file. Test malformed JSON, missing fields, out-of-range numbers, and reload persistence.

### Change the audio graph

Maintain a master gain at the end of the chain and automate transitions. Do not reconnect nodes on every `input` event. Test with headphones beginning at low volume, and test rapid control changes for clicks or exceptions.

### Change install metadata

Edit `public/manifest.webmanifest` and related meta tags in `index.html` together. Preserve root-relative URLs because the production app owns the custom-domain root. Confirm every manifest icon exists in `dist/` and that the served content type is `application/manifest+json`.

To update icons, edit `public/icon-source.svg`, regenerate the raster files at their declared exact sizes, and inspect both regular and maskable results. The maskable icon must have an opaque full-bleed background with important artwork inside the central safe zone. Apple touch icons should also be opaque.

### Update dependencies

Use npm so both `package.json` and `package-lock.json` stay synchronized. Run type checking, production build, audit, and mobile smoke tests. Vite or TypeScript major upgrades require reviewing build output and the GitHub Actions Node version.

### Add offline support

Do not casually register a service worker. If offline operation is explicitly approved, first define which assets and state must work offline, update semantics, cache invalidation, rollback behavior, and how a bad cached audio build is recovered. Then add and test a versioned service worker and revise the product, PWA, deployment, and testing sections of this file.

## Definition of done

A change is complete only when:

- it preserves the static GitHub Pages deployment model;
- TypeScript and the Vite production build succeed;
- it introduces no unrequested runtime service or tracking;
- settings remain safely loadable;
- audio still requires a user gesture and stops when hidden;
- the interface remains one non-scrollable screen across the regression matrix;
- installed Pixel 7 Pro fullscreen behavior is checked for relevant UI changes;
- accessibility state and touch targets remain intact;
- manifest/icon references resolve for PWA changes;
- documentation is updated when an invariant, command, schema, or workflow changes.

## Authoritative external references

- Pixel 7 Pro hardware specifications: <https://support.google.com/pixelphone/answer/7158570?hl=en-GB>
- Android 48 dp touch-target guidance: <https://developer.android.com/guide/topics/ui/accessibility/views/apps-views>
- Chrome PWA display modes and fallbacks: <https://developer.chrome.com/docs/capabilities/display-override>
- Chrome removal of the service-worker fetch-handler install requirement: <https://developer.chrome.com/blog/whats-new-in-web-on-android-io2023>
