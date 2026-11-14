import type { MatchEvent } from './types';

export type Event = MatchEvent;
export type EventIcon = 'wicket' | 'six' | 'four' | 'ball' | 'over' | 'goal' | 'saved' | 'card' | 'substitution' | 'penalty' | 'var' | 'safety-car' | 'flag' | 'pit' | 'position' | 'fastest-lap' | 'retirement';
export type RenderedEvent = { text: string; icon: EventIcon; importance: number };

export interface Adapter {
  load(): Event[];
  render(event: Event): RenderedEvent;
}

export function createCricketAdapter(events: Event[]): Adapter {
  return {
    load: () => events,
    render: event => ({
      text: event.text.en,
      icon: event.type === 'wicket' ? 'wicket' : event.type === 'six' ? 'six' : event.type === 'four' ? 'four' : event.type === 'over_end' ? 'over' : 'ball',
      importance: event.importance,
    }),
  };
}

export function createFootballAdapter(events: Event[]): Adapter {
  return {
    load: () => events,
    render: event => ({
      text: event.text.en,
      icon: ({ goal: 'goal', shot_saved: 'saved', card: 'card', substitution: 'substitution', penalty: 'penalty', var: 'var' } as const)[event.type as 'goal' | 'shot_saved' | 'card' | 'substitution' | 'penalty' | 'var'] || 'goal',
      importance: event.importance,
    }),
  };
}

export function createF1Adapter(events: Event[]): Adapter {
  return {
    load: () => events,
    render: event => ({
      text: event.text.en,
      icon: ({ safety_car: 'safety-car', flag: 'flag', pit_stop: 'pit', position_change: 'position', fastest_lap: 'fastest-lap', retirement: 'retirement' } as const)[event.type as 'safety_car' | 'flag' | 'pit_stop' | 'position_change' | 'fastest_lap' | 'retirement'] || 'position',
      importance: event.importance,
    }),
  };
}
