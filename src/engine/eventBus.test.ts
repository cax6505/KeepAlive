import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './eventBus';

describe('EventBus', () => {
  it('publishes to current subscribers and supports unsubscribe', () => {
    const bus = new EventBus<string>();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = bus.subscribe(first);
    bus.subscribe(second);

    bus.publish('wicket');
    unsubscribe();
    bus.publish('four');

    expect(first.mock.calls).toEqual([['wicket']]);
    expect(second.mock.calls).toEqual([['wicket'], ['four']]);
    expect(bus.subscriberCount).toBe(1);
  });
});
