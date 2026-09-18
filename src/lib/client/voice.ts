/**
 * Browser speech: recognition, synthesis, barge-in, and the analyser feed for
 * the waveform.
 *
 * Capability is detected and reported rather than asserted. Support for
 * `webkitSpeechRecognition` varies by browser, version and platform in ways
 * that are not worth encoding as a table that will be wrong somewhere — so the
 * UI asks this module what it actually found and says so. Text input is always
 * available and never gated on any of this.
 *
 * Two platform details that are easy to get wrong and expensive to miss:
 *
 *   iOS requires a user gesture before `speechSynthesis` will produce sound at
 *   all. A first utterance triggered by an SSE event — not by a tap — is
 *   silently dropped. `unlockAudio()` is called from the first real tap.
 *
 *   `getUserMedia` for the waveform is a second, separate microphone stream
 *   alongside the one recognition opens for itself. On some browsers that
 *   conflicts, so it is wrapped and its failure degrades the visualisation
 *   without touching recognition.
 */

export interface SpeechCapability {
  recognition: boolean;
  synthesis: boolean;
  /** Whether a live waveform is possible — needs getUserMedia and HTTPS. */
  analyser: boolean;
  /** Plain-English summary for the UI. */
  summary: string;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
    length: number;
  }>;
}

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function detectCapability(): SpeechCapability {
  if (typeof window === 'undefined') {
    return { recognition: false, synthesis: false, analyser: false, summary: 'server' };
  }

  const recognition = recognitionCtor() !== null;
  const synthesis = typeof window.speechSynthesis !== 'undefined';
  const analyser =
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.AudioContext !== 'undefined' &&
    window.isSecureContext;

  let summary: string;
  if (recognition && synthesis) {
    summary = 'Microphone and speech are both available in this browser.';
  } else if (!recognition && synthesis) {
    summary =
      'This browser has no speech recognition, so the microphone is unavailable — the agent can ' +
      'still speak its replies. Use the text box, or open this in Chrome for the microphone.';
  } else if (recognition && !synthesis) {
    summary = 'Microphone available, but this browser cannot speak replies. Text is shown instead.';
  } else {
    summary =
      'This browser supports neither speech recognition nor synthesis. Everything works through ' +
      'the text box.';
  }

  return { recognition, synthesis, analyser, summary };
}

// --- Synthesis -------------------------------------------------------------

let audioUnlocked = false;

/**
 * Prime speech synthesis from inside a user gesture.
 *
 * Must be called synchronously in a click/tap handler — an await before it puts
 * the call outside the gesture and iOS will reject it.
 */
export function unlockAudio(): void {
  if (audioUnlocked || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    audioUnlocked = true;
  } catch {
    // Non-fatal: the UI falls back to text.
  }
}

export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

export interface SpeakHandle {
  cancel(): void;
}

/** Pick a plausible English voice, preferring a local one for latency. */
function chooseVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const english = voices.filter((v) => v.lang.startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  return pool.find((v) => v.localService) ?? pool[0];
}

/**
 * Speak text, reporting when audio actually begins.
 *
 * `onStart` fires on the utterance's own start event rather than when speak()
 * is called, because the gap between the two is the TTS latency the strip
 * reports and measuring the call instead would report zero.
 */
export function speak(
  text: string,
  options: { onStart?: () => void; onEnd?: () => void; rate?: number } = {},
): SpeakHandle {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text.trim()) {
    options.onEnd?.();
    return { cancel: () => {} };
  }

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = chooseVoice();
  if (voice) utterance.voice = voice;
  // Slightly quicker than default: this is a hotline operator, not a reader.
  utterance.rate = options.rate ?? 1.06;
  utterance.onstart = () => options.onStart?.();
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onEnd?.();

  window.speechSynthesis.speak(utterance);

  return {
    cancel: () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* already stopped */
      }
    },
  };
}

export function cancelSpeech(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* already stopped */
  }
}

/**
 * Split streamed text into speakable chunks at sentence boundaries.
 *
 * Returns complete sentences and keeps the trailing fragment, so TTS can start
 * on sentence one while the rest is still arriving. The lookahead avoids
 * breaking on a decimal point or an abbreviation, which would otherwise chop
 * "$3,000. to" out of a price range.
 */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;

  const boundary = /([.!?])(\s+|$)/g;
  let lastCut = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(buffer)) !== null) {
    const end = match.index + 1;
    const next = buffer[end + match[2].length];
    // A digit either side of a period is a decimal, not a sentence end.
    if (match[1] === '.' && /\d/.test(buffer[match.index - 1] ?? '') && /\d/.test(next ?? '')) {
      continue;
    }
    const candidate = buffer.slice(lastCut, end + match[2].length);
    // Too short to be a sentence — usually an abbreviation.
    if (candidate.trim().length < 12) continue;
    sentences.push(candidate.trim());
    lastCut = end + match[2].length;
  }

  if (sentences.length > 0) rest = buffer.slice(lastCut);
  return { sentences, rest };
}

// --- Recognition -----------------------------------------------------------

export interface RecognitionHandle {
  stop(): void;
  abort(): void;
}

export interface RecognitionCallbacks {
  /** Fires repeatedly with the growing guess. */
  onInterim(text: string): void;
  /** Fires once per finalised utterance, with how long finalising took. */
  onFinal(text: string, finaliseMs: number): void;
  onError(message: string): void;
  onEnd(): void;
  onStart?(): void;
}

export function startRecognition(callbacks: RecognitionCallbacks): RecognitionHandle | null {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    callbacks.onError('This browser has no speech recognition.');
    return null;
  }

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Ctor();
  } catch {
    callbacks.onError('Speech recognition could not be started.');
    return null;
  }

  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  // Measured from the first interim result rather than from start(), so it
  // reports the time to finalise speech rather than including the silence
  // before the caller began talking.
  let firstInterimAt: number | null = null;

  recognition.onstart = () => callbacks.onStart?.();

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        const finaliseMs = firstInterimAt === null ? 0 : performance.now() - firstInterimAt;
        firstInterimAt = null;
        callbacks.onFinal(transcript.trim(), Number(finaliseMs.toFixed(1)));
      } else {
        interim += transcript;
      }
    }
    if (interim) {
      firstInterimAt ??= performance.now();
      callbacks.onInterim(interim.trim());
    }
  };

  recognition.onerror = (event) => {
    const messages: Record<string, string> = {
      'not-allowed': 'Microphone permission was refused. Use the text box instead.',
      'service-not-allowed': 'The browser blocked speech recognition. Use the text box instead.',
      'no-speech': 'Nothing was heard. Try again, or use the text box.',
      network: 'Speech recognition needs a network connection and could not reach it.',
      aborted: '',
    };
    const message = messages[event.error] ?? `Speech recognition failed (${event.error}).`;
    if (message) callbacks.onError(message);
  };

  recognition.onend = () => callbacks.onEnd();

  try {
    recognition.start();
  } catch {
    callbacks.onError('Speech recognition was already running.');
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    },
    abort: () => {
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}

// --- Analyser for the waveform --------------------------------------------

export interface AnalyserHandle {
  /** Current levels, 0..1, for however many bars the caller wants. */
  levels(bars: number): number[];
  stop(): void;
}

/**
 * Open a microphone stream for visualisation.
 *
 * Deliberately separate from recognition's own stream and non-essential: if
 * this fails, the waveform falls back to a flat line and the microphone still
 * works. Returning null rather than throwing keeps that a one-line check at the
 * call site.
 */
export async function startAnalyser(): Promise<AnalyserHandle | null> {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    return {
      levels(bars: number): number[] {
        analyser.getByteFrequencyData(buffer);
        const out: number[] = [];
        // Ignore the top of the spectrum — it is nearly empty for speech and
        // including it makes the right half of the waveform permanently flat.
        const usable = Math.floor(buffer.length * 0.55);
        const per = Math.max(1, Math.floor(usable / bars));
        for (let b = 0; b < bars; b++) {
          let sum = 0;
          for (let i = 0; i < per; i++) sum += buffer[b * per + i] ?? 0;
          out.push(Math.min(1, sum / per / 180));
        }
        return out;
      },
      stop() {
        for (const track of stream.getTracks()) track.stop();
        void context.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}
