import { describe, expect, it } from 'vitest';
import type { CricketEvent } from '../data/types';
import { clockSnapshot, eventsOnFeed, eventsVisibleOnVideo, jumpToLive, liveClock, missedEvents, videoClock } from './clocks';

const event = (id: string, t: number, importance: 1 | 2 | 3): CricketEvent => ({
  id,
  t,
  sport: 'cricket',
  type: importance === 3 ? 'wicket' : importance === 2 ? 'four' : 'ball',
  importance,
  score: { runs: 1, wkts: 0, overs: '0.1' },
  players: [],
  text: { en: id, hi: `⟦हिंदी · प्रूफ़रीड⟧ ${id}` },
  bytes: 1,
});

describe('replay clocks', () => {
  it('maps elapsed wall time and player time to seconds', () => {
    expect(liveClock(1_000, 11_000)).toBe(10);
    expect(videoClock(4.25)).toBe(4.25);
  });

  it('keeps live time moving while video time is frozen and lag grows one second per second', () => {
    const before = clockSnapshot(liveClock(0, 5_000), videoClock(5));
    const afterTen = clockSnapshot(liveClock(0, 15_000), videoClock(5));
    const afterEleven = clockSnapshot(liveClock(0, 16_000), videoClock(5));

    expect(before.lag).toBe(0);
    expect(afterTen.lag).toBe(10);
    expect(afterEleven.lag - afterTen.lag).toBe(1);
  });

  it('splits feed events from events visible at the video playhead', () => {
    const events = [event('first', 1, 2), event('quiet', 4, 1), event('later', 8, 3)];
    expect(eventsVisibleOnVideo(events, 4).map(item => item.id)).toEqual(['first', 'quiet']);
    expect(eventsOnFeed(events, 8).map(item => item.id)).toEqual(['first', 'quiet', 'later']);
  });

  it('returns only important events that arrived on the feed but are past the frozen video', () => {
    const events = [
      event('visible', 2, 3),
      event('single', 6, 1),
      event('boundary', 7, 2),
      event('wicket', 9, 3),
      event('future', 12, 3),
    ];

    expect(missedEvents(events, 10, 5).map(item => item.id)).toEqual(['boundary', 'wicket']);
  });

  it('loops the video playhead when jumping to a later live position', () => {
    const video = { currentTime: 0, duration: 360 };
    expect(jumpToLive(video, 385)).toBe(25);
    expect(video.currentTime).toBe(25);
  });
});
