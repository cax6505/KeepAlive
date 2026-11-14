import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreezeDetector, type FreezeDetectorEvent } from './freezeDetector';

class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = false;
  seeking = false;
}

class FakeHls {
  private listeners = new Map<string, (...args: any[]) => void>();
  on(name: string, listener: (...args: any[]) => void) { this.listeners.set(name, listener); }
  off(name: string) { this.listeners.delete(name); }
  emit(name: string, data: unknown) { this.listeners.get(name)?.(name, data); }
}

describe('FreezeDetector', () => {
  let video: FakeVideo;
  let browserEvents: EventTarget;
  let events: FreezeDetectorEvent[];
  let detector: FreezeDetector;
  let online: boolean;

  const createDetector = (hls?: FakeHls) => {
    detector = new FreezeDetector(video as unknown as HTMLVideoElement, {
      hls,
      now: () => Date.now(),
      getClocks: () => ({ videoClock: video.currentTime, liveClock: Date.now() / 1000 }),
      windowTarget: browserEvents,
      navigatorTarget: { get onLine() { return online; } },
    });
    events = [];
    detector.subscribe(event => events.push(event));
    detector.start();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    video = new FakeVideo();
    browserEvents = new EventTarget();
    events = [];
    online = true;
  });

  afterEach(() => {
    detector?.stop();
    vi.useRealTimers();
  });

  it('ignores a 1.5-second micro-stutter', () => {
    createDetector();
    video.dispatchEvent(new Event('waiting'));
    vi.advanceTimersByTime(1_000);
    video.currentTime = 0.1;
    vi.advanceTimersByTime(500);

    expect(detector.state).toBe('playing');
    expect(events.some(event => event.state === 'stalled')).toBe(false);
  });

  it('confirms a four-second freeze once and records start clocks', () => {
    createDetector();
    video.dispatchEvent(new Event('waiting'));
    vi.advanceTimersByTime(4_000);

    const confirmed = events.filter(event => event.state === 'stalled');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].stall).toMatchObject({
      id: 'stall-1',
      startedAt: 0,
      endedAt: null,
      cause: 'stream',
      clocksAtStart: { videoClock: 0, liveClock: 0 },
    });
    expect(detector.state).toBe('stalled');
  });

  it('emits one confirmed stall for a five-second network break', () => {
    createDetector();
    video.dispatchEvent(new Event('waiting'));
    vi.advanceTimersByTime(5_000);

    expect(events.filter(event => event.state === 'stalled')).toHaveLength(1);
    expect(events.filter(event => event.stall?.id === 'stall-1')).toHaveLength(2); // suspect + confirmed
    expect(detector.currentStall?.id).toBe('stall-1');
  });

  it('debounces flapping into one stall id', () => {
    createDetector();
    video.dispatchEvent(new Event('waiting'));
    vi.advanceTimersByTime(3_000);
    const id = detector.currentStall?.id;

    video.currentTime = 0.2;
    vi.advanceTimersByTime(500);
    expect(detector.state).toBe('recovering');
    vi.advanceTimersByTime(500);
    expect(detector.state).toBe('stalled');
    video.dispatchEvent(new Event('stalled'));
    vi.advanceTimersByTime(1_000);

    const ids = events.filter(event => event.state === 'stalled').map(event => event.stall?.id);
    expect(id).toBe('stall-1');
    expect(new Set(ids)).toEqual(new Set(['stall-1']));
    expect(detector.currentStall?.startedAt).toBe(0);
  });

  it('labels an offline interruption as user_offline', () => {
    online = false;
    createDetector();
    browserEvents.dispatchEvent(new Event('offline'));
    vi.advanceTimersByTime(3_000);

    expect(events.find(event => event.state === 'stalled')?.stall?.cause).toBe('user_offline');
  });

  it('uses HLS BUFFER_STALLED_ERROR as a non-fatal stall signal', () => {
    const hls = new FakeHls();
    createDetector(hls);
    hls.emit('hlsError', { fatal: false, details: 'bufferStalledError' });
    vi.advanceTimersByTime(3_000);

    expect(events.find(event => event.state === 'stalled')?.stall?.cause).toBe('stream');
  });

  it('recovers only after two seconds of smooth progress and records end clocks', () => {
    createDetector();
    video.dispatchEvent(new Event('waiting'));
    vi.advanceTimersByTime(3_000);
    video.currentTime = 0.2;
    vi.advanceTimersByTime(500);
    expect(detector.state).toBe('recovering');

    for (let i = 0; i < 4; i += 1) {
      video.currentTime += 0.2;
      vi.advanceTimersByTime(500);
    }

    const recovered = events.find(event => event.state === 'recovered');
    expect(events.filter(event => event.state === 'recovered')).toHaveLength(1);
    expect(recovered?.stall).toMatchObject({
      id: 'stall-1',
      endedAt: 5_500,
      clocksAtEnd: { videoClock: 1, liveClock: 5.5 },
    });
    expect(detector.state).toBe('recovered');
  });
});
