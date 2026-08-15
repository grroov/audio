import "./styles.css";

type Waveform = "sine" | "square" | "triangle";

interface SynthSettings {
  waveform: Waveform;
  frequency: number;
  inverted: boolean;
  pan: number;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const STORAGE_KEY = "audio.miernicki.settings.v1";
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const FREQUENCY_STEPS = 1_000;
const OUTPUT_LEVEL = 0.14;

const DEFAULT_SETTINGS: SynthSettings = {
  waveform: "sine",
  frequency: 440,
  inverted: false,
  pan: 0,
};

const WAVE_PATHS: Record<Waveform, string> = {
  sine: "M0 24 C10 3 20 3 30 24 S50 45 60 24 80 3 90 24 110 45 120 24 140 3 150 24 170 45 180 24 200 3 210 24 230 45 240 24",
  square: "M0 40 V8 H30 V40 H60 V8 H90 V40 H120 V8 H150 V40 H180 V8 H210 V40 H240",
  triangle: "M0 40 30 8 60 40 90 8 120 40 150 8 180 40 210 8 240 40",
};

function element<T extends Element>(selector: string): T {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing required element: ${selector}`);
  return match;
}

const app = element<HTMLElement>("#app");
const powerButton = element<HTMLButtonElement>("#powerButton");
const powerLabel = element<HTMLElement>("#powerLabel");
const installButton = element<HTMLButtonElement>("#installButton");
const statusText = element<HTMLElement>("#statusText");
const noteValue = element<HTMLElement>("#noteValue");
const frequencyValue = element<HTMLOutputElement>("#frequencyValue");
const frequencySlider = element<HTMLInputElement>("#frequencySlider");
const invertButton = element<HTMLButtonElement>("#invertButton");
const invertState = element<HTMLElement>("#invertState");
const panSlider = element<HTMLInputElement>("#panSlider");
const panValue = element<HTMLOutputElement>("#panValue");
const scopePath = element<SVGPathElement>("#scopePath");
const toast = element<HTMLElement>("#toast");
const waveButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-waveform]"));

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isWaveform(value: unknown): value is Waveform {
  return value === "sine" || value === "square" || value === "triangle";
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
          ? clamp(stored.frequency, MIN_FREQUENCY, MAX_FREQUENCY)
          : DEFAULT_SETTINGS.frequency,
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
let toastTimer: number | undefined;

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The controls still work if storage is unavailable or full.
  }
}

function frequencyToSlider(frequency: number): number {
  const ratio = Math.log(frequency / MIN_FREQUENCY) / Math.log(MAX_FREQUENCY / MIN_FREQUENCY);
  return clamp(Math.round(ratio * FREQUENCY_STEPS), 0, FREQUENCY_STEPS);
}

function sliderToFrequency(sliderValue: number): number {
  const ratio = clamp(sliderValue, 0, FREQUENCY_STEPS) / FREQUENCY_STEPS;
  return MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, ratio);
}

function formatFrequency(frequency: number): string {
  if (frequency < 1_000) return frequency.toFixed(1);
  if (frequency < 10_000) return frequency.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return Math.round(frequency).toLocaleString("en-US");
}

function describeNote(frequency: number): string {
  const midiValue = 69 + 12 * Math.log2(frequency / 440);
  const midiNote = Math.round(midiValue);
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const name = names[((midiNote % 12) + 12) % 12];
  const octave = Math.floor(midiNote / 12) - 1;
  const cents = Math.round((midiValue - midiNote) * 100);
  const deviation = cents === 0 ? "" : ` ${cents > 0 ? "+" : "−"}${Math.abs(cents)}¢`;
  return `${name}${octave}${deviation}`;
}

function describePan(pan: number): string {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount < 1) return "Center";
  return `${pan < 0 ? "Left" : "Right"} ${amount}`;
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3_200);
}

function pulseHaptic(): void {
  navigator.vibrate?.(8);
}

class AudioEngine {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private polarity: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private output: GainNode | null = null;
  private suspendTimer: number | undefined;

  private createGraph(): void {
    if (this.context) return;

    const context = new AudioContext({ latencyHint: "interactive" });
    const oscillator = new OscillatorNode(context, {
      type: settings.waveform,
      frequency: settings.frequency,
    });
    const polarity = new GainNode(context, { gain: settings.inverted ? -1 : 1 });
    const panner = new StereoPannerNode(context, { pan: settings.pan });
    const output = new GainNode(context, { gain: 0 });

    oscillator.connect(polarity).connect(panner).connect(output).connect(context.destination);
    oscillator.start();

    this.context = context;
    this.oscillator = oscillator;
    this.polarity = polarity;
    this.panner = panner;
    this.output = output;
  }

  async start(): Promise<void> {
    this.createGraph();
    const context = this.context;
    const output = this.output;
    if (!context || !output) return;

    window.clearTimeout(this.suspendTimer);
    await context.resume();
    const now = context.currentTime;
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
    if (!this.context || !this.oscillator) return;
    this.oscillator.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.012);
  }

  setWaveform(waveform: Waveform): void {
    if (this.oscillator) this.oscillator.type = waveform;
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
    this.panner.pan.setTargetAtTime(pan, this.context.currentTime, 0.012);
  }
}

const audioEngine = new AudioEngine();

function updatePlayingUi(): void {
  app.classList.toggle("is-playing", isPlaying);
  powerButton.classList.toggle("is-active", isPlaying);
  powerButton.setAttribute("aria-pressed", String(isPlaying));
  powerButton.setAttribute("aria-label", isPlaying ? "Stop oscillator" : "Start oscillator");
  powerLabel.textContent = isPlaying ? "Stop" : "Start";
  statusText.lastChild!.textContent = isPlaying ? "Live" : "Ready";
}

function renderSettings(): void {
  const sliderValue = frequencyToSlider(settings.frequency);
  const frequencyProgress = (sliderValue / FREQUENCY_STEPS) * 100;

  frequencySlider.value = String(sliderValue);
  frequencySlider.style.setProperty("--frequency-progress", `${frequencyProgress}%`);
  frequencySlider.setAttribute("aria-valuetext", `${formatFrequency(settings.frequency)} hertz`);
  frequencyValue.value = formatFrequency(settings.frequency);
  frequencyValue.textContent = formatFrequency(settings.frequency);
  noteValue.textContent = describeNote(settings.frequency);

  waveButtons.forEach((button) => {
    const isSelected = button.dataset.waveform === settings.waveform;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-checked", String(isSelected));
    button.tabIndex = isSelected ? 0 : -1;
  });

  invertButton.classList.toggle("is-active", settings.inverted);
  invertButton.setAttribute("aria-checked", String(settings.inverted));
  invertState.textContent = settings.inverted ? "Inverted" : "Normal";

  panSlider.value = String(Math.round(settings.pan * 100));
  panSlider.style.setProperty("--pan-position", `${(settings.pan + 1) * 50}%`);
  panSlider.setAttribute("aria-valuetext", describePan(settings.pan));
  panValue.value = describePan(settings.pan);
  panValue.textContent = describePan(settings.pan);

  scopePath.setAttribute("d", WAVE_PATHS[settings.waveform]);
  scopePath.classList.toggle("is-inverted", settings.inverted);
}

async function toggleAudio(): Promise<void> {
  powerButton.disabled = true;
  try {
    if (isPlaying) {
      isPlaying = false;
      audioEngine.stop();
    } else {
      await audioEngine.start();
      isPlaying = true;
      showToast("Tone on — adjust level with device volume.");
    }
    pulseHaptic();
    updatePlayingUi();
  } catch {
    isPlaying = false;
    updatePlayingUi();
    showToast("Audio could not start. Tap Start to try again.");
  } finally {
    powerButton.disabled = false;
  }
}

powerButton.addEventListener("click", () => void toggleAudio());

frequencySlider.addEventListener("input", () => {
  settings.frequency = sliderToFrequency(Number(frequencySlider.value));
  audioEngine.setFrequency(settings.frequency);
  renderSettings();
  saveSettings();
});

panSlider.addEventListener("input", () => {
  settings.pan = clamp(Number(panSlider.value) / 100, -1, 1);
  audioEngine.setPan(settings.pan);
  renderSettings();
  saveSettings();
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
  deferredInstallPrompt = event as BeforeInstallPromptEvent;
  installButton.classList.add("is-ready");
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    showToast("In Chrome, open ⋮ and tap Add to Home screen.");
    return;
  }

  await deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.classList.remove("is-ready");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.hidden = true;
  showToast("Audio installed.");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden || !isPlaying) return;
  isPlaying = false;
  audioEngine.stop();
  updatePlayingUi();
});

const isInstalled =
  window.matchMedia("(display-mode: fullscreen)").matches ||
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

document.documentElement.classList.toggle("is-installed", isInstalled);
if (isInstalled) installButton.hidden = true;

renderSettings();
updatePlayingUi();
