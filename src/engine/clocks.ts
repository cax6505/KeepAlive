import type { MatchEvent } from '../data/types';

export type ClockSnapshot = {
  liveClock: number;
  videoClock: number;
  lag: number;
};

export function liveClock(startedAtMs: number, nowMs = performance.now()): number {
  return Math.max(0, (nowMs - startedAtMs) / 1000);
}

export function videoClock(currentTime: number): number {
  return Math.max(0, currentTime || 0);
}

export function clockSnapshot(livePosition: number, videoPosition: number): ClockSnapshot {
  const live = Math.max(0, livePosition);
  const video = Math.max(0, videoPosition);
  return { liveClock: live, videoClock: video, lag: live - video };
}

export function eventsVisibleOnVideo<T extends Pick<MatchEvent, 't'>>(events: T[], videoPosition: number): T[] {
  return events.filter(event => event.t <= videoPosition);
}

export function eventsOnFeed<T extends Pick<MatchEvent, 't'>>(events: T[], livePosition: number): T[] {
  return events.filter(event => event.t <= livePosition);
}

export function missedEvents(
  events: MatchEvent[],
  livePosition: number,
  videoPosition: number,
  minimumImportance = 2,
): MatchEvent[] {
  const visibleIds = new Set(eventsVisibleOnVideo(events, videoPosition).map(event => event.id));
  return eventsOnFeed(events, livePosition).filter(event => !visibleIds.has(event.id) && event.importance >= minimumImportance);
}

export type SeekableVideo = { currentTime: number; duration: number };

export function jumpToLive(video: SeekableVideo, livePosition: number): number {
  const target = Number.isFinite(video.duration) && video.duration > 0
    ? ((livePosition % video.duration) + video.duration) % video.duration
    : Math.max(0, livePosition);
  video.currentTime = target;
  return target;
}
