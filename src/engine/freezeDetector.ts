import type Hls from 'hls.js';
import type { Events } from 'hls.js';

export type FreezeState = 'playing' | 'suspect' | 'stalled' | 'recovering' | 'recovered';
export type StallCause = 'stream' | 'user_offline';

export type FreezeDetectorConfig = {
  stallConfirmMs: number;
  recoverConfirmMs: number;
  watchdogIntervalMs: number;
  progressThresholdSeconds: number;
};

export const DEFAULT_FREEZE_DETECTOR_CONFIG: Readonly<FreezeDetectorConfig> = Object.freeze({
  stallConfirmMs: 3_000,
  recoverConfirmMs: 2_000,
  watchdogIntervalMs: 500,
  progressThresholdSeconds: 0.05,
});

export type ClockValues = { videoClock: number; liveClock: number };
export type StallRecord = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  cause: StallCause;
  clocksAtStart: ClockValues;
  clocksAtEnd: ClockValues | null;
};

export type FreezeDetectorEvent = {
  state: FreezeState;
  at: number;
  stall: StallRecord | null;
};

type HlsError = { fatal?: boolean; details?: string };
export type HlsEventSource = Pick<Hls, 'on' | 'off'>;
type EventTargetLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
export type FreezeDetectorOptions = {
  hls?: HlsEventSource | null;
  config?: Partial<FreezeDetectorConfig>;
  getClocks?: () => ClockValues;
  now?: () => number;
  windowTarget?: EventTargetLike;
  navigatorTarget?: Pick<Navigator, 'onLine'>;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
};
type Listener = (event: FreezeDetectorEvent) => void;
type Candidate = StallRecord;

const HLS_ERROR_EVENT = 'hlsError' as Events.ERROR;
const HLS_BUFFER_STALLED_ERROR = 'bufferStalledError';

/** Detects sustained playback freezes without depending on React or a UI. */
export class FreezeDetector {
  private readonly config: FreezeDetectorConfig;
  private readonly now: () => number;
  private readonly getClocks: () => ClockValues;
  private readonly windowTarget?: EventTargetLike;
  private readonly navigatorTarget?: Pick<Navigator, 'onLine'>;
  private readonly setIntervalFn: typeof globalThis.setInterval;
  private readonly clearIntervalFn: typeof globalThis.clearInterval;
  private readonly listeners = new Set<Listener>();
  private timer: ReturnType<typeof globalThis.setInterval> | null = null;
  private confirmTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private sequence = 0;
  private previousTime = 0;
  private candidate: Candidate | null = null;
  private activeStall: StallRecord | null = null;
  private recoveryStartedAt: number | null = null;
  private currentState: FreezeState = 'playing';
  private running = false;

  constructor(private readonly video: HTMLVideoElement, private readonly options: FreezeDetectorOptions = {}) {
    this.config = { ...DEFAULT_FREEZE_DETECTOR_CONFIG, ...options.config };
    this.now = options.now || (() => Date.now());
    this.getClocks = options.getClocks || (() => ({ videoClock: video.currentTime, liveClock: this.now() / 1000 }));
    this.windowTarget = options.windowTarget || (typeof window !== 'undefined' ? window : undefined);
    this.navigatorTarget = options.navigatorTarget || (typeof navigator !== 'undefined' ? navigator : undefined);
    this.setIntervalFn = options.setInterval || globalThis.setInterval.bind(globalThis);
    this.clearIntervalFn = options.clearInterval || globalThis.clearInterval.bind(globalThis);
    this.previousTime = video.currentTime;
  }

  get state(): FreezeState { return this.currentState; }
  get currentStall(): StallRecord | null { return this.copyStall(this.activeStall || this.candidate); }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousTime = this.video.currentTime;
    this.video.addEventListener('waiting', this.onVideoStall);
    this.video.addEventListener('stalled', this.onVideoStall);
    this.video.addEventListener('playing', this.onVideoPlaying);
    this.video.addEventListener('pause', this.onPauseOrSeek);
    this.video.addEventListener('seeking', this.onPauseOrSeek);
    this.windowTarget?.addEventListener('offline', this.onOffline);
    this.windowTarget?.addEventListener('online', this.onOnline);
    this.options.hls?.on(HLS_ERROR_EVENT, this.onHlsError);
    this.timer = this.setIntervalFn(this.watchdog, this.config.watchdogIntervalMs);
    this.emit(this.currentState, this.activeStall);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) this.clearIntervalFn(this.timer);
    this.timer = null;
    if (this.confirmTimer !== null) globalThis.clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.video.removeEventListener('waiting', this.onVideoStall);
    this.video.removeEventListener('stalled', this.onVideoStall);
    this.video.removeEventListener('playing', this.onVideoPlaying);
    this.video.removeEventListener('pause', this.onPauseOrSeek);
    this.video.removeEventListener('seeking', this.onPauseOrSeek);
    this.windowTarget?.removeEventListener('offline', this.onOffline);
    this.windowTarget?.removeEventListener('online', this.onOnline);
    this.options.hls?.off?.(HLS_ERROR_EVENT, this.onHlsError);
  }

  private readonly onVideoStall = (): void => {
    if (this.isActivelyPlaying()) this.beginSuspect();
  };

  private readonly onVideoPlaying = (): void => {
    this.previousTime = this.video.currentTime;
    // A `playing` event can fire while currentTime is still frozen. The watchdog
    // confirms recovery from actual clock progress, avoiding flapping on HLS retries.
  };

  private readonly onPauseOrSeek = (): void => {
    if (this.video.paused || this.video.seeking) {
      if (this.currentState === 'suspect') this.cancelSuspect();
      this.previousTime = this.video.currentTime;
    }
  };

  private readonly onOffline = (): void => {
    if (this.isActivelyPlaying()) this.beginSuspect();
  };

  private readonly onOnline = (): void => {
    // Connectivity alone is not recovery; smooth video progress confirms it.
  };

  private readonly onHlsError = (_eventName: string, error: HlsError): void => {
    if (error?.fatal || error?.details !== HLS_BUFFER_STALLED_ERROR) return;
    if (this.isActivelyPlaying()) this.beginSuspect();
  };

  private readonly watchdog = (): void => {
    if (!this.running) return;
    const now = this.now();
    if (!this.isActivelyPlaying()) {
      if (this.currentState === 'suspect') this.cancelSuspect();
      this.previousTime = this.video.currentTime;
      return;
    }

    const currentTime = this.video.currentTime;
    const advanced = currentTime - this.previousTime > this.config.progressThresholdSeconds;
    this.previousTime = currentTime;

    if (advanced) {
      this.onProgress(now);
      return;
    }

    if (this.currentState === 'playing' || this.currentState === 'recovered') {
      this.beginSuspect(now);
      return;
    }
    if (this.currentState === 'suspect' && this.candidate && now - this.candidate.startedAt >= this.config.stallConfirmMs) {
      this.confirmStall(now);
      return;
    }
    if (this.currentState === 'recovering') this.returnToStalled(now);
  };

  private onProgress(now: number): void {
    if (this.currentState === 'suspect') {
      this.cancelSuspect();
      return;
    }
    if (this.currentState === 'stalled' && this.activeStall) {
      this.beginRecovery(now);
      return;
    }
    if (this.currentState === 'recovering' && this.recoveryStartedAt !== null && now - this.recoveryStartedAt >= this.config.recoverConfirmMs) {
      this.finishRecovery(now);
      return;
    }
    if (this.currentState === 'recovered') this.transition('playing', null, now);
  }

  private beginSuspect(at = this.now()): void {
    if (this.currentState === 'suspect' || this.currentState === 'stalled') return;
    if (this.currentState === 'recovering' && this.activeStall) {
      this.returnToStalled(at);
      return;
    }
    this.sequence += 1;
    const clocks = this.getClocks();
    this.candidate = {
      id: `stall-${this.sequence}`,
      startedAt: at,
      endedAt: null,
      cause: this.isOffline() ? 'user_offline' : 'stream',
      clocksAtStart: { videoClock: clocks.videoClock, liveClock: clocks.liveClock },
      clocksAtEnd: null,
    };
    this.transition('suspect', this.candidate, at);
    // In production confirm at the configured boundary instead of waiting for
    // the next 500ms watchdog tick. Injected-clock tests stay fully deterministic.
    if (!this.options.now) {
      this.confirmTimer = globalThis.setTimeout(() => {
        this.confirmTimer = null;
        if (this.currentState === 'suspect' && this.candidate) this.confirmStall(this.now());
      }, this.config.stallConfirmMs);
    }
  }

  private confirmStall(at: number): void {
    if (!this.candidate || this.activeStall) return;
    if (this.confirmTimer !== null) globalThis.clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.candidate = { ...this.candidate, cause: this.isOffline() ? 'user_offline' : this.candidate.cause };
    this.activeStall = this.candidate;
    this.candidate = null;
    this.transition('stalled', this.activeStall, at);
  }

  private beginRecovery(at = this.now()): void {
    if (!this.activeStall || this.currentState === 'recovering') return;
    this.recoveryStartedAt = at;
    this.transition('recovering', this.activeStall, at);
  }

  private returnToStalled(at: number): void {
    if (!this.activeStall) return;
    this.recoveryStartedAt = null;
    this.transition('stalled', this.activeStall, at);
  }

  private finishRecovery(at: number): void {
    if (!this.activeStall) return;
    const clocks = this.getClocks();
    const completed: StallRecord = {
      ...this.activeStall,
      endedAt: at,
      clocksAtEnd: { videoClock: clocks.videoClock, liveClock: clocks.liveClock },
    };
    this.activeStall = null;
    this.candidate = null;
    this.recoveryStartedAt = null;
    this.transition('recovered', completed, at);
  }

  private cancelSuspect(): void {
    if (this.currentState !== 'suspect') return;
    if (this.confirmTimer !== null) globalThis.clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.candidate = null;
    this.transition('playing', null, this.now());
  }

  private transition(state: FreezeState, stall: StallRecord | null, at: number): void {
    this.currentState = state;
    this.emit(state, stall, at);
  }

  private emit(state: FreezeState, stall: StallRecord | null, at = this.now()): void {
    const event = { state, at, stall: this.copyStall(stall) };
    for (const listener of [...this.listeners]) listener(event);
  }

  private copyStall(stall: StallRecord | null): StallRecord | null {
    return stall ? {
      ...stall,
      clocksAtStart: { ...stall.clocksAtStart },
      clocksAtEnd: stall.clocksAtEnd ? { ...stall.clocksAtEnd } : null,
    } : null;
  }

  private isActivelyPlaying(): boolean {
    return !this.video.paused && !this.video.seeking;
  }

  private isOffline(): boolean {
    return this.navigatorTarget?.onLine === false;
  }
}

export function createFreezeDetector(video: HTMLVideoElement, options?: FreezeDetectorOptions): FreezeDetector {
  return new FreezeDetector(video, options);
}

