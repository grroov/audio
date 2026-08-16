import "./styles.css";

type Waveform = "sine" | "square" | "triangle";

interface SynthSettings {
  waveform: Waveform;
  frequency: number;
  spread: number;
  inverted: boolean;
  pan: number;
}

interface OscillatorVoice {
  oscillator: OscillatorNode;
  gain: GainNode;
}

interface VoiceTarget {
  frequency: number;
  gain: number;
}

interface ScopeVoicePath {
  voiceIndex: number;
  position: number;
  path: SVGPathElement;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NoticeOptions {
  persistent?: boolean;
  urgent?: boolean;
  installAction?: boolean;
}

const STORAGE_KEY = "audio.miernicki.settings.v1";
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const FREQUENCY_STEPS = 1_000;
const MIN_SPREAD = 0;
const MAX_SPREAD = 48;
const SPREAD_FADE_IN_RANGE = 12;
const VOICE_POSITIONS = [
  -0.5,
  -0.375,
  -0.25,
  -0.125,
  0,
  0.125,
  0.25,
  0.375,
  0.5,
] as const;
const OUTPUT_LEVEL = 0.14;
const NOTICE_DURATION = 8_000;
const PAN_PRESET_TRANSITION_MS = 500;
const SCOPE_WIDTH = 240;
const SCOPE_MIDLINE = 24;
const SCOPE_AMPLITUDE = 16;
const SCOPE_CENTER_CYCLES = 4;
const SCOPE_SAMPLES = 192;
const MAX_SCOPE_SPREAD_OPACITY = 0.28;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const DEFAULT_SETTINGS: SynthSettings = {
  waveform: "sine",
  frequency: 440,
  spread: 0,
  inverted: false,
  pan: 0,
};

function element<T extends Element>(selector: string): T {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing required element: ${selector}`);
  return match;
}

const app = element<HTMLElement>("#app");
const powerButton = element<HTMLButtonElement>("#powerButton");
const statusText = element<HTMLElement>("#statusText");
const frequencyValue = element<HTMLOutputElement>("#frequencyValue");
const frequencySlider = element<HTMLInputElement>("#frequencySlider");
const spreadValue = element<HTMLOutputElement>("#spreadValue");
const spreadSlider = element<HTMLInputElement>("#spreadSlider");
const invertButton = element<HTMLButtonElement>("#invertButton");
const panSlider = element<HTMLInputElement>("#panSlider");
const scopePath = element<SVGPathElement>("#scopePath");
const scopeCutoutPath = element<SVGPathElement>("#scopeCutoutPath");
const scopeBundle = element<SVGGElement>("#scopeBundle");
const scopeSpreadPathGroup = element<SVGGElement>("#scopeSpreadPaths");
const notice = element<HTMLElement>("#notice");
const noticeText = element<HTMLElement>("#noticeText");
const noticeInstallButton = element<HTMLButtonElement>("#noticeInstallButton");
const noticeCloseButton = element<HTMLButtonElement>("#noticeCloseButton");
const controlAnnouncement = element<HTMLElement>("#controlAnnouncement");
const helpButton = element<HTMLButtonElement>("#helpButton");
const helpModal = element<HTMLDialogElement>("#helpModal");
const helpCloseButton = element<HTMLButtonElement>("#helpCloseButton");
const helpScrollbar = element<HTMLElement>("#helpScrollbar");
const helpScrollbarThumb = element<HTMLElement>("#helpScrollbarThumb");
const waveButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-waveform]"));
const panPresetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-pan-preset]"),
);
const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
const scopeVoicePaths: ScopeVoicePath[] = [];

VOICE_POSITIONS.forEach((position, voiceIndex) => {
  if (position === 0) return;
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.classList.add("scope-spread-line");
  scopeSpreadPathGroup.append(path);
  scopeVoicePaths.push({ voiceIndex, position, path });
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeFrequency(frequency: number): number {
  return Math.round(clamp(frequency, MIN_FREQUENCY, MAX_FREQUENCY));
}

function normalizeSpread(spread: number): number {
  return Math.round(clamp(spread, MIN_SPREAD, MAX_SPREAD));
}

function isWaveform(value: unknown): value is Waveform {
  return value === "sine" || value === "square" || value === "triangle";
}

function sampleWaveform(waveform: Waveform, phase: number): number {
  const cyclePhase = phase - Math.floor(phase);
  if (waveform === "sine") return Math.sin(phase * Math.PI * 2);
  if (waveform === "square") return cyclePhase < 0.5 ? 1 : -1;
  return 1 - 4 * Math.abs(cyclePhase - 0.5);
}

function createScopePath(waveform: Waveform, cycles: number): string {
  let pathData = "";
  let previousY: number | undefined;

  for (let sampleIndex = 0; sampleIndex <= SCOPE_SAMPLES; sampleIndex += 1) {
    const progress = sampleIndex / SCOPE_SAMPLES;
    const x = Math.round(progress * SCOPE_WIDTH * 100) / 100;
    const sample = sampleWaveform(waveform, progress * cycles);
    const y = Math.round((SCOPE_MIDLINE - sample * SCOPE_AMPLITUDE) * 100) / 100;

    if (sampleIndex === 0) {
      pathData = `M${x} ${y}`;
    } else {
      if (waveform === "square" && previousY !== undefined && y !== previousY) {
        pathData += `L${x} ${previousY}`;
      }
      pathData += `L${x} ${y}`;
    }

    previousY = y;
  }

  return pathData;
}

function loadSettings(): SynthSettings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };

    const stored = value as Partial<SynthSettings>;
    return {
      waveform: isWaveform(stored.waveform) ? stored.waveform : DEFAULT_SETTINGS.waveform,
      frequency:
        typeof stored.frequency === "number" && Number.isFinite(stored.frequency)
          ? normalizeFrequency(stored.frequency)
          : DEFAULT_SETTINGS.frequency,
      spread:
        typeof stored.spread === "number" && Number.isFinite(stored.spread)
          ? normalizeSpread(stored.spread)
          : DEFAULT_SETTINGS.spread,
      inverted: typeof stored.inverted === "boolean" ? stored.inverted : DEFAULT_SETTINGS.inverted,
      pan:
        typeof stored.pan === "number" && Number.isFinite(stored.pan)
          ? clamp(stored.pan, -1, 1)
          : DEFAULT_SETTINGS.pan,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();
let isPlaying = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let noticeTimer: number | undefined;
let noticeHideTimer: number | undefined;
let announcementTimer: number | undefined;
let displayedPan = settings.pan;
let activePanPreset: number | null = null;
let panAnimationFrame: number | undefined;
let panAnimationEndTime: number | undefined;
let audioActionVersion = 0;

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Controls remain functional when storage is unavailable or full.
  }
}

function frequencyToSlider(frequency: number): number {
  const ratio = Math.log(frequency / MIN_FREQUENCY) / Math.log(MAX_FREQUENCY / MIN_FREQUENCY);
  return clamp(Math.round(ratio * FREQUENCY_STEPS), 0, FREQUENCY_STEPS);
}

function sliderToFrequency(sliderValue: number): number {
  const ratio = clamp(sliderValue, 0, FREQUENCY_STEPS) / FREQUENCY_STEPS;
  return normalizeFrequency(MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, ratio));
}

function formatFrequency(frequency: number): string {
  return String(normalizeFrequency(frequency));
}

function formatSpread(spread: number): string {
  return String(normalizeSpread(spread));
}

function describeSpread(centerFrequency: number, spread: number): string {
  const normalizedSpread = normalizeSpread(spread);
  if (normalizedSpread === 0) return "0 semitones, single frequency";

  const halfSpreadOctaves = normalizedSpread / 24;
  const lowFrequency = normalizeFrequency(centerFrequency * Math.pow(2, -halfSpreadOctaves));
  const highFrequency = normalizeFrequency(centerFrequency * Math.pow(2, halfSpreadOctaves));
  return `${normalizedSpread} semitones total, ${lowFrequency} to ${highFrequency} hertz`;
}

function getVoiceTargets(centerFrequency: number, spread: number): VoiceTarget[] {
  const normalizedSpread = normalizeSpread(spread);
  const sideVoiceMix = clamp(normalizedSpread / SPREAD_FADE_IN_RANGE, 0, 1);
  const rawTargets = VOICE_POSITIONS.map((position) => {
    const frequency = centerFrequency * Math.pow(2, (normalizedSpread * position) / 12);
    const isAudible = frequency >= MIN_FREQUENCY && frequency <= MAX_FREQUENCY;
    const rawGain = isAudible ? (position === 0 ? 1 : sideVoiceMix) : 0;
    return {
      frequency: clamp(frequency, MIN_FREQUENCY, MAX_FREQUENCY),
      rawGain,
    };
  });
  const totalGain = rawTargets.reduce((sum, target) => sum + target.rawGain, 0) || 1;

  return rawTargets.map((target) => ({
    frequency: target.frequency,
    gain: target.rawGain / totalGain,
  }));
}

function renderScope(): void {
  const centerPath = createScopePath(settings.waveform, SCOPE_CENTER_CYCLES);
  const targets = getVoiceTargets(settings.frequency, settings.spread);
  const spreadOpacity =
    clamp(settings.spread / SPREAD_FADE_IN_RANGE, 0, 1) * MAX_SCOPE_SPREAD_OPACITY;

  scopePath.setAttribute("d", centerPath);
  scopeCutoutPath.setAttribute("d", centerPath);
  scopeBundle.classList.toggle("is-inverted", settings.inverted);

  scopeVoicePaths.forEach((voice) => {
    const voiceCycles =
      SCOPE_CENTER_CYCLES * Math.pow(2, (settings.spread * voice.position) / 12);
    voice.path.setAttribute("d", createScopePath(settings.waveform, voiceCycles));
    voice.path.style.opacity = targets[voice.voiceIndex].gain > 0 ? String(spreadOpacity) : "0";
  });
}

function describePan(pan: number): string {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount < 1) return "Both channels";
  return `${amount}% ${pan < 0 ? "left" : "right"}`;
}

function getPanAnimationRemainingSeconds(): number {
  if (panAnimationEndTime === undefined) return 0;
  return Math.max(0, (panAnimationEndTime - performance.now()) / 1_000);
}

function hideNotice(): void {
  window.clearTimeout(noticeTimer);
  window.clearTimeout(noticeHideTimer);
  notice.classList.remove("is-visible");
  noticeHideTimer = window.setTimeout(() => {
    notice.hidden = true;
  }, 200);
}

function showNotice(message: string, options: NoticeOptions = {}): void {
  window.clearTimeout(noticeTimer);
  window.clearTimeout(noticeHideTimer);
  notice.setAttribute("role", options.urgent ? "alert" : "status");
  notice.setAttribute("aria-live", options.urgent ? "assertive" : "polite");
  notice.classList.toggle("is-install-notice", options.installAction === true);
  noticeInstallButton.hidden = options.installAction !== true;
  noticeCloseButton.textContent = options.installAction ? "Cancel" : "Dismiss";
  noticeText.textContent = message;
  notice.hidden = false;
  requestAnimationFrame(() => notice.classList.add("is-visible"));

  if (!options.persistent) {
    noticeTimer = window.setTimeout(hideNotice, NOTICE_DURATION);
  }
}

function showInstallNotice(): void {
  showNotice("Install Audio for fullscreen access from your home screen.", {
    persistent: true,
    installAction: true,
  });
}

function announce(message: string): void {
  window.clearTimeout(announcementTimer);
  controlAnnouncement.textContent = "";
  announcementTimer = window.setTimeout(() => {
    controlAnnouncement.textContent = message;
  }, 40);
}

function pulseHaptic(): void {
  navigator.vibrate?.(8);
}

class AudioEngine {
  private context: AudioContext | null = null;
  private voices: OscillatorVoice[] = [];
  private polarity: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private output: GainNode | null = null;
  private suspendTimer: number | undefined;

  private createGraph(): void {
    if (this.context) return;

    const context = new AudioContext({ latencyHint: "interactive" });
    const mix = new GainNode(context, { gain: 1 });
    const polarity = new GainNode(context, { gain: settings.inverted ? -1 : 1 });
    const panner = new StereoPannerNode(context, { pan: displayedPan });
    const output = new GainNode(context, { gain: 0 });
    const targets = getVoiceTargets(settings.frequency, settings.spread);
    const voices = VOICE_POSITIONS.map((_, index): OscillatorVoice => {
      const target = targets[index];
      const oscillator = new OscillatorNode(context, {
        type: settings.waveform,
        frequency: target.frequency,
      });
      const gain = new GainNode(context, { gain: target.gain });
      oscillator.connect(gain).connect(mix);
      oscillator.start();
      return { oscillator, gain };
    });

    mix.connect(polarity).connect(panner).connect(output).connect(context.destination);

    this.context = context;
    this.voices = voices;
    this.polarity = polarity;
    this.panner = panner;
    this.output = output;
  }

  private updateVoices(centerFrequency: number, spread: number): void {
    const context = this.context;
    if (!context || this.voices.length === 0) return;

    const now = context.currentTime;
    const targets = getVoiceTargets(centerFrequency, spread);
    this.voices.forEach((voice, index) => {
      const target = targets[index];
      voice.oscillator.frequency.cancelScheduledValues(now);
      voice.oscillator.frequency.setValueAtTime(voice.oscillator.frequency.value, now);
      voice.oscillator.frequency.setTargetAtTime(target.frequency, now, 0.012);
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.setTargetAtTime(target.gain, now, 0.025);
    });
  }

  async start(): Promise<void> {
    this.createGraph();
    const context = this.context;
    const output = this.output;
    if (!context || !output) return;

    window.clearTimeout(this.suspendTimer);
    await context.resume();
    const now = context.currentTime;
    if (this.panner) {
      const pan = this.panner.pan;
      pan.cancelScheduledValues(now);
      pan.setValueAtTime(displayedPan, now);
      const remainingSeconds = getPanAnimationRemainingSeconds();
      if (remainingSeconds > 0) {
        pan.linearRampToValueAtTime(settings.pan, now + remainingSeconds);
      }
    }
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);
    output.gain.linearRampToValueAtTime(OUTPUT_LEVEL, now + 0.045);
  }

  stop(): void {
    const context = this.context;
    const output = this.output;
    if (!context || !output) return;

    const now = context.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);
    output.gain.linearRampToValueAtTime(0, now + 0.04);
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = window.setTimeout(() => {
      if (!isPlaying) void context.suspend();
    }, 70);
  }

  setFrequency(frequency: number): void {
    this.updateVoices(frequency, settings.spread);
  }

  setSpread(spread: number): void {
    this.updateVoices(settings.frequency, spread);
  }

  setWaveform(waveform: Waveform): void {
    this.voices.forEach((voice) => {
      voice.oscillator.type = waveform;
    });
  }

  setInverted(inverted: boolean): void {
    if (!this.context || !this.polarity) return;
    const now = this.context.currentTime;
    this.polarity.gain.cancelScheduledValues(now);
    this.polarity.gain.setValueAtTime(this.polarity.gain.value, now);
    this.polarity.gain.linearRampToValueAtTime(inverted ? -1 : 1, now + 0.025);
  }

  setPan(pan: number): void {
    if (!this.context || !this.panner) return;
    const now = this.context.currentTime;
    this.panner.pan.cancelAndHoldAtTime(now);
    this.panner.pan.setTargetAtTime(pan, now, 0.012);
  }

  rampPan(pan: number, durationSeconds: number): void {
    if (!this.context || !this.panner || this.context.state !== "running") return;
    const now = this.context.currentTime;
    this.panner.pan.cancelAndHoldAtTime(now);
    this.panner.pan.linearRampToValueAtTime(pan, now + Math.max(0, durationSeconds));
  }
}

const audioEngine = new AudioEngine();

function updatePlayingUi(): void {
  app.classList.toggle("is-playing", isPlaying);
  powerButton.classList.toggle("is-active", isPlaying);
  powerButton.setAttribute("aria-pressed", String(isPlaying));
  powerButton.setAttribute("aria-label", isPlaying ? "Pause tone" : "Play tone");
  statusText.textContent = isPlaying ? "Tone is playing" : "Sound is off";
}

function updateHelpScrollbar(): void {
  if (!helpModal.open) return;

  const trackHeight = helpScrollbar.clientHeight;
  const viewportHeight = helpModal.clientHeight;
  const contentHeight = helpModal.scrollHeight;
  if (trackHeight <= 0 || viewportHeight <= 0 || contentHeight <= 0) return;

  const proportionalHeight = trackHeight * (viewportHeight / contentHeight);
  const thumbHeight = Math.min(trackHeight, Math.max(56, proportionalHeight));
  const maximumScroll = Math.max(0, contentHeight - viewportHeight);
  const maximumTravel = Math.max(0, trackHeight - thumbHeight);
  const thumbOffset =
    maximumScroll > 0 ? (helpModal.scrollTop / maximumScroll) * maximumTravel : 0;

  helpScrollbarThumb.style.height = `${thumbHeight}px`;
  helpScrollbarThumb.style.transform = `translateY(${thumbOffset}px)`;
}

function openHelp(): void {
  if (helpModal.open) return;

  audioActionVersion += 1;
  isPlaying = false;
  audioEngine.stop();
  updatePlayingUi();

  helpModal.showModal();
  helpModal.scrollTop = 0;
  helpCloseButton.focus();
  requestAnimationFrame(updateHelpScrollbar);
  pulseHaptic();
}

function closeHelp(): void {
  if (!helpModal.open) return;
  helpModal.close();
  pulseHaptic();
}

function renderPanSettings(): void {
  panSlider.value = String(Math.round(displayedPan * 100));
  panSlider.style.setProperty("--pan-position", `${(displayedPan + 1) * 50}%`);
  panSlider.setAttribute("aria-valuetext", describePan(displayedPan));
  panSlider.setAttribute("aria-label", `Fine stereo position, ${describePan(displayedPan)}`);

  const selectedPan = activePanPreset ?? displayedPan;
  panPresetButtons.forEach((button) => {
    const preset = Number(button.dataset.panPreset);
    const isSelected = Number.isFinite(preset) && Math.abs(selectedPan - preset) < 0.005;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function renderSettings(): void {
  const sliderValue = frequencyToSlider(settings.frequency);
  const frequencyProgress = (sliderValue / FREQUENCY_STEPS) * 100;
  const formattedFrequency = formatFrequency(settings.frequency);
  const formattedSpread = formatSpread(settings.spread);
  const spreadDescription = describeSpread(settings.frequency, settings.spread);

  frequencySlider.value = String(sliderValue);
  frequencySlider.style.setProperty("--slider-progress", `${frequencyProgress}%`);
  frequencySlider.setAttribute("aria-valuetext", `${formattedFrequency} hertz`);
  frequencySlider.setAttribute("aria-label", `Frequency, ${formattedFrequency} hertz`);
  frequencyValue.value = formattedFrequency;
  frequencyValue.textContent = formattedFrequency;
  frequencyValue.setAttribute("aria-label", `Frequency, ${formattedFrequency} hertz`);

  spreadSlider.value = formattedSpread;
  spreadSlider.style.setProperty(
    "--slider-progress",
    `${(settings.spread / MAX_SPREAD) * 100}%`,
  );
  spreadSlider.setAttribute("aria-valuetext", spreadDescription);
  spreadSlider.setAttribute("aria-label", `Frequency spread, ${spreadDescription}`);
  spreadValue.value = formattedSpread;
  spreadValue.textContent = formattedSpread;
  spreadValue.setAttribute("aria-label", `Frequency spread, ${spreadDescription}`);

  waveButtons.forEach((button) => {
    const isSelected = button.dataset.waveform === settings.waveform;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-checked", String(isSelected));
    button.tabIndex = isSelected ? 0 : -1;
  });

  invertButton.classList.toggle("is-active", settings.inverted);
  invertButton.setAttribute("aria-checked", String(settings.inverted));

  renderScope();

  renderPanSettings();
}

function cancelPanPresetAnimation(): void {
  if (panAnimationFrame !== undefined) cancelAnimationFrame(panAnimationFrame);
  panAnimationFrame = undefined;
  panAnimationEndTime = undefined;
  activePanPreset = null;
}

function animatePanTo(targetPan: number): void {
  cancelPanPresetAnimation();

  const target = clamp(targetPan, -1, 1);
  const startPan = displayedPan;
  settings.pan = target;
  activePanPreset = target;
  saveSettings();
  renderPanSettings();

  if (reducedMotionMedia.matches || Math.abs(target - startPan) < 0.0001) {
    displayedPan = target;
    activePanPreset = null;
    audioEngine.setPan(target);
    renderPanSettings();
    return;
  }

  const startTime = performance.now();
  panAnimationEndTime = startTime + PAN_PRESET_TRANSITION_MS;
  audioEngine.rampPan(target, PAN_PRESET_TRANSITION_MS / 1_000);

  const updatePan = (timestamp: number): void => {
    const progress = clamp((timestamp - startTime) / PAN_PRESET_TRANSITION_MS, 0, 1);
    displayedPan = startPan + (target - startPan) * progress;
    renderPanSettings();

    if (progress < 1) {
      panAnimationFrame = requestAnimationFrame(updatePan);
      return;
    }

    displayedPan = target;
    activePanPreset = null;
    panAnimationFrame = undefined;
    panAnimationEndTime = undefined;
    renderPanSettings();
  };

  panAnimationFrame = requestAnimationFrame(updatePan);
}

function setFrequency(frequency: number): void {
  settings.frequency = normalizeFrequency(frequency);
  audioEngine.setFrequency(settings.frequency);
  renderSettings();
  saveSettings();
}

function setSpread(spread: number): void {
  settings.spread = normalizeSpread(spread);
  audioEngine.setSpread(settings.spread);
  renderSettings();
  saveSettings();
}

async function toggleAudio(): Promise<void> {
  const actionVersion = ++audioActionVersion;
  powerButton.disabled = true;
  try {
    if (isPlaying) {
      isPlaying = false;
      audioEngine.stop();
    } else {
      await audioEngine.start();
      if (actionVersion !== audioActionVersion || helpModal.open || document.hidden) {
        isPlaying = false;
        audioEngine.stop();
        updatePlayingUi();
        return;
      }
      isPlaying = true;
    }
    pulseHaptic();
    updatePlayingUi();
  } catch {
    isPlaying = false;
    updatePlayingUi();
    showNotice("Audio could not start. Select Dismiss, then try the Play button again.", {
      persistent: true,
      urgent: true,
    });
  } finally {
    powerButton.disabled = false;
  }
}

powerButton.addEventListener("click", () => void toggleAudio());
helpButton.addEventListener("click", openHelp);
helpCloseButton.addEventListener("click", closeHelp);
helpModal.addEventListener("scroll", updateHelpScrollbar, { passive: true });
helpModal.addEventListener("close", () => helpButton.focus());
window.addEventListener("resize", updateHelpScrollbar);
window.visualViewport?.addEventListener("resize", updateHelpScrollbar);
noticeCloseButton.addEventListener("click", hideNotice);
noticeInstallButton.addEventListener("click", async () => {
  const installPrompt = deferredInstallPrompt;
  if (!installPrompt) {
    showNotice("In Chrome, open the three-dot menu and select Add to Home screen.", {
      persistent: true,
      installAction: true,
    });
    return;
  }

  noticeInstallButton.disabled = true;
  try {
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    deferredInstallPrompt = null;
    if (choice.outcome === "accepted") hideNotice();
    else showInstallNotice();
  } catch {
    deferredInstallPrompt = null;
    showNotice("In Chrome, open the three-dot menu and select Add to Home screen.", {
      persistent: true,
      installAction: true,
    });
  } finally {
    noticeInstallButton.disabled = false;
  }
});

frequencySlider.addEventListener("input", () => {
  setFrequency(sliderToFrequency(Number(frequencySlider.value)));
});

spreadSlider.addEventListener("input", () => {
  setSpread(Number(spreadSlider.value));
});

panSlider.addEventListener("input", () => {
  cancelPanPresetAnimation();
  displayedPan = clamp(Number(panSlider.value) / 100, -1, 1);
  settings.pan = displayedPan;
  audioEngine.setPan(settings.pan);
  renderPanSettings();
  saveSettings();
});

panPresetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const pan = Number(button.dataset.panPreset);
    if (!Number.isFinite(pan)) return;
    animatePanTo(pan);
    announce(`Stereo position ${describePan(clamp(pan, -1, 1))}`);
    pulseHaptic();
  });
});

invertButton.addEventListener("click", () => {
  settings.inverted = !settings.inverted;
  audioEngine.setInverted(settings.inverted);
  renderSettings();
  saveSettings();
  pulseHaptic();
});

waveButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    const waveform = button.dataset.waveform;
    if (!isWaveform(waveform)) return;
    settings.waveform = waveform;
    audioEngine.setWaveform(waveform);
    renderSettings();
    saveSettings();
    pulseHaptic();
  });

  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextButton = waveButtons[(index + offset + waveButtons.length) % waveButtons.length];
    nextButton.click();
    nextButton.focus();
  });
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (document.documentElement.classList.contains("is-installed")) return;
  deferredInstallPrompt = event as BeforeInstallPromptEvent;
  showInstallNotice();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.documentElement.classList.add("is-installed");
  showNotice("Audio was installed successfully.");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  audioActionVersion += 1;
  isPlaying = false;
  audioEngine.stop();
  updatePlayingUi();
});

const isInstalled =
  window.matchMedia("(display-mode: fullscreen)").matches ||
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

document.documentElement.classList.toggle("is-installed", isInstalled);

renderSettings();
updatePlayingUi();
