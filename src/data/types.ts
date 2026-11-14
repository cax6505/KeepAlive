export type Sport = 'cricket' | 'football' | 'f1';
export type CricketEventType = 'wicket' | 'six' | 'four' | 'milestone' | 'over_end' | 'ball';
export type FootballEventType = 'goal' | 'shot_saved' | 'card' | 'substitution' | 'penalty' | 'var';
export type F1EventType = 'safety_car' | 'flag' | 'pit_stop' | 'position_change' | 'fastest_lap' | 'retirement';
export type EventType = CricketEventType | FootballEventType | F1EventType;
export type ScoreDisplay = { label: string; value: string; context: string };
export type EventScore = { runs: number; wkts: number; overs: string; display?: ScoreDisplay };

export type MatchEvent = {
  id: string;
  t: number;
  sport: Sport;
  type: EventType;
  importance: 1 | 2 | 3;
  score: EventScore;
  players: string[];
  text: { en: string; hi: string };
  bytes: number;
};

export type CricketEvent = MatchEvent & { sport: 'cricket'; type: CricketEventType; score: EventScore };

export type CricketDemo = {
  source: { provider: string; id: string; dataVersion: string; attribution: string };
  match: { teams: string[]; date: string; venue: string; event: string; outcome: { winner?: string; by?: Record<string, number>; result?: string } };
  events: CricketEvent[];
};

export type SportDemo = {
  source: { provider: string; id: string | number; attribution: string; [key: string]: unknown };
  match: { teams: string[]; date: string; venue: string; event: string; outcome: Record<string, unknown> };
  events: MatchEvent[];
};
