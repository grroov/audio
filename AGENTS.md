# Audio project handbook

This file applies to the entire repository. It is both the implementation reference and the maintenance contract for agents and contributors working on `audio.miernicki.com`.

## Product definition

Audio is a mobile-only signal generator delivered as an installable Progressive Web App. Its primary target is Chrome on Android, with the installed fullscreen experience on a Google Pixel 7 Pro treated as the reference layout. The visual design is intentionally optimized for an older adult who may have reduced near vision, contrast sensitivity, or fine motor precision.

The application must remain:

- fully static after `npm run build`;
- deployable from `dist/` to GitHub Pages at `https://audio.miernicki.com/`;
- usable without a server, API, account, database, analytics, or telemetry;
- portrait-first, with a non-scrollable Large-text instrument surface and an intentionally scrolling Large-text Help dialog;
- zoomable to at least 200% without an author restriction, with vertical reflow rather than horizontal overflow when zoom or an unusually short viewport requires it;
- installable with a Web App Manifest;
- online-only, with no service worker unless offline behavior becomes an explicit product requirement;
- silent until the user presses the Play button;
- persistent for user control settings, but never persistent for the playing/stopped state.

The current product surface is intentionally narrow: a normalized nine-voice oscillator bank, three waveforms, center frequency, total frequency spread, polarity inversion, stereo position, and power. Do not introduce unrelated features while making maintenance changes.

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

- `index.html`: complete semantic interface, PWA meta tags, the layered full-bleed waveform preview, the two-section Help dialog, and the Vite entry point.
- `dev.sh`: preferred local launcher; prints the app URL, owns the Vite process, and shuts it down on Control-C.
- `src/main.ts`: settings validation, UI rendering, adaptive waveform-bundle geometry, Web Audio graph, event handling, installation flow, and installed-mode detection.
- `src/styles.css`: the complete dark, Large-text visual system, responsive height rules, safe-area handling, and control styling.
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

1. A borderless adaptive waveform bundle spans the full shell width above all controls. Its crisp center trace preserves the selected base shape while eight translucent surrounding traces separate as total spread increases. A dark knockout stroke keeps the center trace legible through the bundle.
2. Top three-way wave-shape selector: text-only SINE, SQUARE, and TRIANGLE buttons, with no icons, separate visible section title, or outer group border. Selection uses a full foreground/background inversion rather than a checkmark. These buttons always share the same responsive height as the `LEFT`/`CENTER`/`RIGHT` stereo preset buttons.
3. One borderless combined synthesis stage. Its top row is an exact 50/50 split containing two non-editable readouts: whole center frequency plus a visibly spaced `Hz` suffix on the left, and whole spread plus a visibly spaced `SEMITONES` suffix on the right. There are no frequency or spread minus/plus controls. “Semitones” names the total musical interval covered from the lowest outer voice to the highest, and the resulting frequency range is exposed to assistive technology. The lower area is an exact three-column split: logarithmic center-frequency labels to the left of their slider, three equal square Play/Pause, `INVERT`, and `?` Help buttons stacked in the middle, and the spread slider followed by its linear labels on the outer right. Tick marks point inward toward their respective tracks. The middle buttons use compact fixed gaps so all three remain reachable at short heights. There are no vertical dividers. Playing state remains available through a visually hidden live region.
4. The `?` button opens a native modal Help dialog in the browser top layer. It fills the complete viewport with a permanent white background, black text, a sticky title/Close header, and an always-visible custom black scrollbar on a gray rail. Help contains exactly two main sections: “Frequency generation” and “Semitones and voices.” Opening it stops a playing tone; closing it returns focus to `?`.
5. Bottom control: `LEFT`/`CENTER`/`RIGHT` stereo presets with inverted selected colors and a visually unlabelled horizontal fine-position slider. Its accessible name and value text remain available to assistive technology.
6. A live-region notice overlays the bottom without changing layout. The browser-only installation notice has Install and Cancel actions; other notices have Dismiss.

The page has no routes or alternate view modes. Dark colors and Large typography are permanent on the instrument. The shell is fixed to the viewport and `body` is not scrollable at supported phone heights; viewport heights below 500 CSS px intentionally switch to a vertically scrolling reflow layout. The white Help dialog is the deliberate exception: it owns an independent vertical scroller because its reference text exceeds one screen. Horizontal scrolling is never acceptable. On constrained heights, reduce ornamental spacing or hide secondary instructional copy before reducing core controls below the compact floors.

## Audio implementation

### Signal chain

The graph is created lazily after a user gesture:

```text
9 × OscillatorNode
  -> 9 × per-voice GainNode (spread fade and normalized level)
  -> shared mix GainNode
  -> polarity GainNode (+1 normal, -1 inverted)
  -> StereoPannerNode (-1 left through 0 center to +1 right)
  -> master GainNode (click-free start/stop envelope)
  -> AudioContext.destination
```

Important invariants:

- Never autoplay. `AudioContext` creation/resume must remain downstream of pressing Play.
- Keep output conservative. `OUTPUT_LEVEL` is currently `0.14`; increasing it requires an explicit product decision and physical listening tests beginning at low device volume.
- The master output ramps to the target over 45 ms and ramps to zero over 40 ms to avoid clicks.
- Voice frequencies and directly dragged pan changes use `setTargetAtTime` with a 12 ms time constant. Voice gains use a 25 ms target while the spread changes. Pan preset presses use a 500 ms linear ramp synchronized with the visible fader movement.
- Polarity crosses between +1 and -1 with a 25 ms linear ramp.
- All nine oscillators are started once when the graph is created. Stop silences the master gain and suspends the context rather than destroying the graph.
- At zero spread, only the center oscillator is audible. Side voices fade in over the first 12 semitones of total spread, so moving away from zero does not abruptly add eight full-level voices.
- Audible per-voice gains always normalize to a sum of one, preserving the former single-oscillator peak ceiling. A voice whose calculated frequency falls outside 20–20,000 Hz is muted and the remaining voices are renormalized.
- The app automatically stops when the document becomes hidden. A sustained test tone must not continue accidentally after the user leaves the app.
- Opening Help also stops playback because the full-screen modal makes the underlying Play/Pause control unavailable until Help closes.
- Playing state is session-only and always initializes as stopped.
- The app does not request microphone access. It generates output only.

### Waveforms

The supported waveform union is:

```ts
type Waveform = "sine" | "square" | "triangle";
```

These names map directly to every voice's `OscillatorNode.type`; all nine voices always use the same selected shape. Selector buttons use uppercase text without icons. The full-bleed preview is deliberately representative rather than sampled analyser output. `sampleWaveform` and `createScopePath` in `src/main.ts` generate fixed-sample SVG geometry for all three shapes. The bright center trace always shows four visual cycles. Eight translucent paths use the same non-center `VOICE_POSITIONS` as the audio bank and change their visual cycle count according to `4 * 2^((spread * position) / 12)`. The whole bundle flips vertically for inversion. No waveform path animates during playback; the graphic changes only when waveform, spread, inversion, or frequency-limit muting changes.

The preview communicates spectral density without implying increased output level: the center stroke remains 3 px at every spread, surrounding traces fade from zero to a maximum opacity of `0.28` over the first 12 semitones, and an 8 px shell-colored under-stroke cuts a clear channel behind the center. Muted out-of-range audio voices also hide their corresponding visual traces. The result is a stable visual explanation of the settings, not the instantaneous summed time-domain waveform.

When adding a waveform, update all of the following together:

1. the `Waveform` union;
2. `isWaveform` validation;
3. the `sampleWaveform` branch and `createScopePath` geometry;
4. the uppercase text-only selector button in `index.html`;
5. the segmented-control grid styling if the number of options changes;
6. persistence and reload testing;
7. physical listening tests for level and clicks.

### Frequency model

Frequency spans 20 Hz to 20,000 Hz. The native range control exposes integer values from 0 through 1,000, but the mapping is logarithmic so equal travel represents equal frequency ratios.

Forward mapping:

```text
frequency = 20 * (20000 / 20)^(slider / 1000)
```

Inverse mapping:

```text
slider = round(log(frequency / 20) / log(20000 / 20) * 1000)
```

The mapped result is rounded to the nearest whole hertz before it reaches settings, persistence, display, accessibility text, or the audio graph. Do not replace the logarithmic mapping with a linear frequency slider. A linear 20–20,000 Hz control would make the musically useful low-frequency range nearly impossible to select.

The readout is a non-editable semantic `output`: it contains no decimal places or grouping commas and is followed by a visible `Hz` suffix. Its accessible label includes both the value and unit. The native range is the only frequency control; it supports track taps, dragging, and keyboard range interaction. There are no frequency nudge buttons or direct numeric entry.

### Frequency-spread model

Spread is the total pitch width of a discrete nine-line oscillator cluster, not a continuous noise band or a filter bandwidth. It is stored and displayed as a whole number from 0 through 48 semitones. One semitone is one twelfth of an octave in equal temperament; 12 semitones span one octave, 24 span two, and 48 span four. The value describes the complete lowest-to-highest interval, so a 12-semitone spread places the outer voices 6 semitones below and above center. The native spread range is linear with `min="0"`, `max="48"`, and `step="1"`. It is the only spread control and supports track taps, dragging, and keyboard range interaction. There are no spread nudge buttons or direct numeric entry.

The fixed normalized voice positions are:

```text
-0.5, -0.375, -0.25, -0.125, 0, +0.125, +0.25, +0.375, +0.5
```

For each position:

```text
voice frequency = center frequency * 2^((spread semitones * position) / 12)
```

The outer voices therefore sit half the total spread below and above the center. At a 440 Hz center, representative outer limits are 440–440 Hz at 0 semitones, approximately 311–622 Hz at 12, 220–880 Hz at 24, and 110–1,760 Hz at 48. The middle voice remains exactly at the chosen center frequency.

At zero spread, side-voice raw gain is zero and center raw gain is one. Side raw gain rises linearly as `spread / 12`, capped at one; after out-of-range voices are muted, every audible raw gain is divided by the audible total. Keep this normalization and the 20–20,000 Hz mute boundary together. Do not stack nine identical full-level oscillators at zero, randomize detuning, recreate nodes during slider input, or describe this control as producing continuous spectral energy.

The adaptive preview reuses these positions and mute decisions. At zero it shows only one sharp center path. As spread rises, the eight side paths fan into different visual cycle counts and reach full visual opacity at 12 semitones. This bundle is supplemental: the `SEMITONES` readout remains the exact statement of spread.

### Stereo position and inversion

The pan range in stored state is `-1` through `+1`; the HTML slider uses `-100` through `100`. `StereoPannerNode` supplies equal-power panning. At center, the normalized mono voice mix feeds both channels. At either extreme, only the corresponding side remains. `LEFT`, `CENTER`, and `RIGHT` preset buttons provide large single-tap alternatives to the fine-position slider. A preset press selects the button immediately, persists the destination, and moves both the visible fader and live audio pan linearly from their current position to the destination over 500 ms. Manual slider input cancels an active preset movement. When `prefers-reduced-motion: reduce` is active, the visible preset movement completes immediately and audio retains its short click-prevention smoothing.

Inversion multiplies the entire mono voice mix by `-1` before panning. The result sounds the same in isolation, but the phase relationship is materially different when combined with another signal. Preserve this control as a global polarity operation, not a visual-only flag or a per-voice phase control.

## Persistent state

Settings are stored in `localStorage` under:

```text
audio.miernicki.settings.v1
```

Schema:

```ts
interface SynthSettings {
  waveform: "sine" | "square" | "triangle";
  frequency: number; // whole integer, clamped to 20..20000 Hz
  spread: number; // whole integer, clamped to 0..48 total semitones
  inverted: boolean;
  pan: number; // clamped to -1..1
}
```

Defaults are sine, 440 Hz, zero spread, normal polarity, and centered pan. Loading treats stored data as untrusted: validate types, reject unknown waveform values, round legacy fractional frequency or spread values to whole units, clamp numeric values, and fall back field-by-field. An old version-1 object without `spread` loads safely with zero spread, so this additive change does not require a new storage key. Storage failures are intentionally non-fatal. Legacy `textSize` or `theme` properties in version-1 storage are ignored and disappear the next time settings are saved.

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

Chrome's `beforeinstallprompt` event is captured and deferred. There is no header or permanent Install button. Receiving that event identifies an installable, not-yet-installed browser session and surfaces a persistent bottom notice with Install and Cancel buttons. Install invokes the deferred prompt; if the prompt is unavailable, it explains the Chrome “Add to Home screen” menu path. Cancel dismisses the notice for the current page load. `appinstalled` removes the installation notice and shows transient success confirmation. Installed-mode media queries and JavaScript detection must suppress the installation notice immediately when launched from the home screen.

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
- Hide the browser-only installation notice in `fullscreen` and `standalone` display modes without waiting for JavaScript, preventing first-frame flash.
- Add an `.is-installed` root class from display-mode detection so installed-only tuning is testable and does not depend solely on CSS media support.
- Keep the icon-only Play/Pause control in the middle third of the synthesis stage, directly above `INVERT`, with the `?` Help button below both.
- Keep stereo position at the bottom, but above the bottom safe/gesture inset.
- Target 48–96 CSS px controls on the reference device. Slider thumbs are visibly 48 px rather than relying only on an invisible hit area.
- Do not put controls under the centered hole-punch/cutout area. The decorative preview may span the width, but safe-area-aware top padding must keep controls clear.
- Keep the instrument surface near-black to avoid a pure-white full-screen background on the OLED display. The explicitly requested Help dialog is the sole exception: it fills the viewport with a white background and black text for maximum reading contrast.
- Do not block pinch zoom. The viewport meta element must not contain `user-scalable=no` or a `maximum-scale` below `2`.
- Optimize with width/height media queries, not a `Pixel 7 Pro` user-agent check.

## Visual design system

### Character

The app should feel like a precise pocket instrument: restrained, technical, high contrast, and immediately legible. It is not a generic dashboard. Use the full-bleed waveform bundle, calibrated labels, and a small number of strong states rather than decorative cards, dense scope grids, or illustrations. Readability takes priority over ornamental information.

### Palette

Canonical dark-theme custom properties live in `:root`; there are no alternate theme selectors:

- `--ink: #f1f3eb`: primary text and knob centers;
- `--muted: #aeb5af`: secondary labels, approximately 9.4:1 against the shell;
- `--faint: #9aa29c`: calibration and tertiary copy, approximately 7.5:1 against the shell;
- `--panel: #111514`: base panel color;
- `--control-line: #737c76`: meaningful control boundaries and slider tracks;
- `--accent: #ff7a50`: full-bleed waveform preview, frequency progress, and solid slider thumbs;
- `--accent-soft: #3a211a`: selected fills;
- `--live: #b7f54a`: audio-live state only.

Essential text must remain at least 4.5:1 and meaningful control graphics at least 3:1; aim for 7:1 on operational labels. Do not reuse decorative low-contrast colors for instructions or values.

Do not use color alone to communicate state. Selected controls also change surface, text, position, `aria-checked`, or label copy. Reserve green for “audio is currently producing output.”

### Type

- Use system UI fonts for actions; there are no remote font requests.
- Use the system monospace stack only for frequency/spread digits and numeric calibration.
- Frequency and spread digits use tabular numerals.
- Use conventional sentence case except for the deliberately uppercase SINE, SQUARE, TRIANGLE, INVERT, LEFT, CENTER, and RIGHT control labels. Avoid tracked all-caps elsewhere and avoid unexplained abbreviations.
- Pixel operational labels are approximately 16 CSS px, parameter readouts approximately 32 px, and calibration labels approximately 14 px. The narrow-width parameter readout floor is 24 px so five frequency digits or the full `SEMITONES` unit remain contained in their half-width readout. The root size is permanently 16 px; there is no selectable type scale.

### Geometry and spacing

- The maximum shell width is 520 px so desktop previews remain phone-shaped.
- Primary horizontal gutters are 18 px; compact screens use 13 px.
- Panels and controls generally use visible 2 px boundaries and approximately 12–14 px radii. The combined synthesis stage and both slider-and-label groups are intentional borderless exceptions.
- The frequency stage consumes all flexible vertical space.
- The parameter-editor row is an exact two-column split. The left 50% holds the frequency readout and full `Hz` unit; the right 50% holds the spread readout and full `SEMITONES` unit. A `0.4rem` flex gap visibly separates each number from its unit at every responsive size. Each editor remains internally contained and neither is centered across the full stage.
- The stage's lower area is an exact three-column split: center-frequency labels then slider own the left third, playback and inversion own the middle third, and the spread slider then labels own the right third. This mirrors the tracks around the middle controls and places both sets of calibration labels at the outer edges. Keep the split free of vertical separators.
- Waveform-selector and stereo-preset buttons share one height contract: 54 px by default, 58 px in the Pixel/tall-phone band, and 48 px on compact-height screens. Change both together.
- The waveform preview uses one 3 px center trace, eight 2 px translucent spread traces, and one 8 px shell-colored center under-stroke. Do not communicate spread by thickening the center trace: that would incorrectly suggest increased amplitude. Avoid blur; geometric separation and the knockout channel must remain visible on the OLED display.
- Play/Pause, `INVERT`, and `?` are equal responsive squares sized at 90 px by default, 96 px in the Pixel/tall-phone band, 85 px on compact widths, 77 px at heights through 720 px, and 72 px at heights through 600 px. Gaps are respectively 16, 18, 14, 10, and 8 px through `--tone-button-gap`; the three-button stack supersedes the former one-button-height gap. Change the size and gap custom properties rather than sizing an individual button. The Play/Pause icon remains 43 px, `INVERT` remains 16 px at base and 14 px compact, and `?` is 36 px at base and 32 px compact.
- Frequency, spread, and pan tracks are 10–12 px thick; their thumbs are solid accent-colored 48 px circles with no concentric border rings. Each visible vertical rail is inset by the 24 px thumb radius at its top and bottom while the native range input retains the full column height as its touch area. This lets the thumb center reach each visible rail endpoint and align horizontally with the center of the corresponding top or bottom calibration label.
- The pan track has a high-contrast center calibration mark.
- Avoid shadows except for shallow selected-state separation, knobs, the live output glow, and notice elevation.

### Motion and feedback

- Transitions should usually remain between 150 and 200 ms. The functional stereo preset glide is deliberately 500 ms.
- Audio parameter automation, not CSS, prevents sound clicks.
- The adaptive waveform preview is never animated. Its stable geometry changes only in response to waveform, spread, inversion, or boundary muting, making the display easier to inspect.
- Respect `prefers-reduced-motion` by effectively disabling animations and transitions.
- Android haptic feedback is an optional 8 ms vibration. Functionality must not depend on vibration support.
- Installation guidance uses a persistent Install/Cancel notice. Recoverable errors use a large dismissible notice; only success confirmation may time out, after eight seconds. Notices overlay without changing layout.

## Interaction and accessibility

- Use semantic native buttons and range inputs.
- The three waveform buttons form a `radiogroup`, expose `aria-checked`, and support Left/Right arrow navigation with roving `tabIndex`.
- Waveform and stereo preset selection use full foreground/background inversion without visual checkmarks; semantic state remains exposed through `aria-checked` or `aria-pressed`.
- Invert waveform is an `INVERT` button with the standard 2 px control border whose foreground and background invert when active. It retains `role="switch"`, `aria-checked`, and the accessible label “Invert waveform”; the representative waveform also flips vertically.
- Power uses `aria-pressed`, retains a changing Play/Pause accessible label, and swaps its decorative play and pause icons. It has no visible text label.
- Help is a native modal `dialog` opened by a `?` button with `aria-haspopup="dialog"` and `aria-controls`. The dialog is labelled by its visible title, has a persistent Close button, supports the platform's dialog-cancel behavior, and returns focus to the opener after closing.
- Range controls update `aria-valuetext` to human-readable frequency, total-spread/range, and pan descriptions.
- Frequency and spread have non-editable readouts but no nudge controls. Their native ranges support tapping the track and keyboard operation in addition to dragging. The full visible `SEMITONES` suffix replaces the unexplained `ST` abbreviation. Stereo retains `LEFT`/`CENTER`/`RIGHT` preset alternatives.
- Sound status, notices, and control announcements are atomic live regions with an urgency appropriate to their content.
- All meaningful SVGs used only for decoration are `aria-hidden`.
- The complete waveform bundle is decorative and must stay hidden from assistive technology; frequency and `SEMITONES` readouts provide the exact state independently of its color, opacity, or geometry.
- Maintain a visible 4 px `:focus-visible` outline even though Android touch is the primary input.
- Never depend on hover.
- Keep `touch-action: none` on sliders so a drag changes the control instead of invoking browser movement. Buttons use manipulation semantics.
- Keep tap targets separated; expanding one target must not overlap another.
- Selection and live state must use text, borders, checks, position, or surface changes in addition to color.
- Browser zoom is enabled. At enlarged presentation, vertical scrolling is preferable to clipped or overlapping controls; horizontal scrolling remains prohibited.
- Help deliberately scrolls even though the instrument surface does not. Its native scrollbar is visually replaced by a fixed 14 px rail and a JavaScript-synchronized thumb with a 56 px minimum height, so a scrollbar remains visible on Android even when browser scrollbars auto-hide. The rail is presentational; touch, wheel, keyboard, and assistive scrolling continue to operate the native dialog scroller.

## Responsive behavior

The base CSS targets mainstream phones. Media-query priorities are:

1. installed `fullscreen`/`standalone`: suppress the installation notice immediately and apply safe-area-aware full-screen tuning;
2. Pixel/tall phone band (`min-width` around 390 px and `min-height` around 840 px): increase touch targets and use the available length of both vertical tracks while fitting the three middle buttons;
3. compact width (`max-width: 370px`): reduce gutters, parameter type, and selector type while preserving the 50/50 readout row, the three equal lower columns, full-bleed preview geometry, and notice actions below their message;
4. compact height (`max-height: 720px`): shorten gaps and use 77 px middle buttons while preserving 48 px controls and the 14 px label floor;
5. very short height (`max-height: 600px`): use 72 px middle buttons with 8 px gaps and allow internal shell scrolling only when safe-area insets would otherwise clip a control; without such insets the standard 320 × 568 layout still has no actual scroll range;
6. heights below 500 px: use a vertically scrolling shell with no horizontal overflow.

After any responsive change, prove `document.body.scrollWidth === innerWidth` at the full regression matrix. Also prove `document.body.scrollHeight === innerHeight` at supported phone heights; the below-500-px fallback may have greater scroll height when its content requires it. A visually hidden or transformed element can still create overflow, so test computed dimensions rather than relying only on screenshots.

## Performance and privacy

- There are no runtime network requests after the page assets load.
- Do not add analytics, tracking, cookies, advertising, accounts, or third-party scripts without an explicit product requirement.
- Do not collect or transmit generated settings.
- Prefer inline/vector UI artwork and system fonts.
- Keep production output small. The accessibility baseline is approximately 104 KB total, including icons, and roughly 43 KB of HTML/CSS/JS before gzip. Investigate material growth.
- Animate only transforms, opacity, or simple SVG stroke properties where practical.
- Keep one persistent audio graph with nine oscillator/gain voice pairs rather than allocating or reconnecting nodes on slider input.

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
- the decorative waveform reaches both shell edges without creating horizontal overflow;
- no scrollbars or pull-to-refresh movement at supported phone heights;
- power, waveform, invert, Help, both parameter readouts, both vertical sliders, stereo presets, and pan slider remain reachable;
- at each vertical slider's minimum and maximum, the thumb center reaches the visible rail endpoint and aligns horizontally with the center of the corresponding bottom or top calibration label;
- selector labels do not wrap or clip;
- bottom pan control clears the safe area;
- an eligible, non-installed browser session shows the Install/Cancel notice and installed mode does not;
- the below-500-px fallback scrolls vertically when needed, never horizontally, and keeps every control reachable;
- the permanent dark theme preserves text, control, selection, and focus contrast.

Automated interaction smoke tests should cover:

- each waveform selection updates `aria-checked`, the center/cutout geometry, and all eight spread paths;
- frequency slider updates the non-editable visible and accessible readout;
- spread slider updates its visible readout, accessible total width, calculated low/high range, and adaptive waveform bundle;
- pan slider and `LEFT`/`CENTER`/`RIGHT` presets update the visible fader position and accessible values;
- inversion updates `aria-checked`, the button's inverted surface, and the preview orientation;
- all settings, including spread, survive reload while playing state does not;
- Play enters the live UI state and Pause exits it;
- Help opens as a full-viewport modal, stops live audio, begins at scroll position zero, keeps its custom scrollbar visible and synchronized, closes by its button and platform cancel action, and restores focus to `?`;
- hiding the document stops playback;
- no console or page errors occur.

### Physical Pixel 7 Pro

Before a release that changes audio, manifest, or viewport behavior:

1. Open the HTTPS production site in current Chrome for Android.
2. Confirm the Install/Cancel notice appears, Cancel dismisses it, and Install or the Chrome menu installation succeeds.
3. Launch from the Android home screen and confirm there is no URL bar or browser chrome.
4. Confirm portrait startup, safe-area clearance, and no installation-notice flash.
5. Begin with device volume low; test Play/Pause and listen for clicks.
6. Test sine, square, and triangle across low, middle, and high center frequencies; confirm the center and all spread traces preserve the selected geometry and remain unanimated while stopped and live.
7. At each waveform, test spread at 0, a narrow intermediate value, 12, 24, and 48 semitones. Confirm zero displays one crisp path, side traces separate and become denser as spread grows, the dark knockout keeps the center legible, wider settings form stable discrete audio clusters, perceived level remains conservative, and rapid frequency/spread changes do not click.
8. Near 20 Hz and 20,000 Hz, widen spread and confirm out-of-range voice muting remains stable and error-free.
9. Test inversion while playing and confirm the preview flips vertically.
10. Use stereo headphones to verify center, full left, full right, and intermediate pan.
11. Open Help while playing and confirm the tone stops. Read both sections, verify the white/black presentation and persistent scrollbar throughout the document, close Help, and confirm focus returns to `?` while playback remains stopped.
12. Test the permanent dark/Large instrument presentation, pinch zoom, and vertical-only reflow when enlarged content no longer fits. Confirm the Help dialog remains readable and independently scrollable when zoomed.
13. Change every setting, close the PWA, relaunch it, and confirm restoration while remaining stopped.
14. Send the app to the background while playing and confirm it stops.
15. Rotate the phone and confirm the installed app remains portrait or degrades without horizontal overflow if Android temporarily ignores the lock.

Do not perform high-frequency or high-volume physical tests through headphones for prolonged periods.

## Maintenance recipes

### Change styling

Edit `src/styles.css`, not generated assets in `dist/`. Keep state classes (`.is-playing`, `.is-active`, `.is-selected`, `.is-installed`) consistent with `src/main.ts`. Do not reintroduce theme or text-size selectors without an explicit product change. Re-run the complete viewport matrix when changing grid rows, safe-area padding, slider sizes, or font metrics.

### Change Help

Edit Help copy and semantic headings in `index.html`. Preserve exactly two top-level content sections—frequency generation and semitones/voices—unless the product structure explicitly changes. Keep the native modal `dialog`, sticky Close control, white background, black text, safe-area padding, enabled text selection, and independent native scrolling. The fixed custom rail is required because Android may auto-hide native scrollbar chrome; when changing the dialog structure or dimensions, preserve `updateHelpScrollbar`, its open/scroll/viewport updates, and the 56 px minimum thumb. Opening Help must invalidate any pending audio start, stop current playback, and leave playback stopped after close. Update this handbook when explanations diverge from the actual formulas, voice positions, signal chain, limits, or gain behavior.

### Change settings

Update the TypeScript interface, defaults, loader validation, renderer, event listener, and this file. Test malformed JSON, missing fields, invalid waveform strings, out-of-range numbers, old partial version-1 objects without `spread`, and reload persistence. Old display-preference fields must remain harmless when encountered but are not part of the current schema.

### Change the audio graph

Maintain the nine fixed voice branches, shared normalized mix, polarity stage, panner, and master gain at the end of the chain. Automate frequency and gain transitions; do not recreate or reconnect nodes on every `input` event. Keep out-of-range voice muting and renormalization coupled. Test with headphones beginning at low volume, and test rapid center-frequency and spread changes for clicks or exceptions.

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
- the dark/Large instrument remains one non-scrollable screen across the regression matrix, while the white/Large Help dialog scrolls independently with its persistent scrollbar;
- very short or browser-zoomed layouts reflow vertically without horizontal overflow or clipped controls, and browser zoom remains enabled;
- installed Pixel 7 Pro fullscreen behavior is checked for relevant UI changes;
- accessible names, live state, plain-language labels, contrast, non-drag alternatives, and touch targets remain intact;
- Help remains full-screen, technically accurate, keyboard/cancel closable, independently scrollable, and capable of stopping audio before obscuring the instrument;
- manifest/icon references resolve for PWA changes;
- documentation is updated when an invariant, command, schema, or workflow changes.

## Authoritative external references

- Pixel 7 Pro hardware specifications: <https://support.google.com/pixelphone/answer/7158570?hl=en-GB>
- Android 48 dp touch-target guidance: <https://developer.android.com/guide/topics/ui/accessibility/views/apps-views>
- W3C older-user accessibility guidance: <https://www.w3.org/WAI/older-users/>
- WCAG 2.2 resize-text guidance: <https://www.w3.org/WAI/WCAG22/Understanding/resize-text>
- WCAG 2.2 contrast guidance: <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum>
- WCAG 2.2 dragging alternatives: <https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html>
- Chrome PWA display modes and fallbacks: <https://developer.chrome.com/docs/capabilities/display-override>
- Chrome removal of the service-worker fetch-handler install requirement: <https://developer.chrome.com/blog/whats-new-in-web-on-android-io2023>
