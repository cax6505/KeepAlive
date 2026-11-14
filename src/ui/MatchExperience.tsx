import { useEffect, useRef, useState } from 'react';
import type { MatchEvent, Sport } from '../data/types';
import type { RenderedEvent } from '../data/adapters';
import { EventGlyph } from './EventGlyph';

type Mode = 'everything' | 'back';
type Language = 'en' | 'hi';

type Props = {
  phase: 'stalled' | 'recovering' | 'recap';
  events: MatchEvent[];
  missed: MatchEvent[];
  elapsedSeconds: number;
  gapSeconds: number;
  runsMissed: number;
  liveScore: MatchEvent['score'];
  recapLiveClock?: number;
  recapVideoClock?: number;
  stallStartClock?: number;
  sport: Sport;
  renderEvent: (event: MatchEvent) => RenderedEvent;
  offline: boolean;
  language: Language;
  followed: string[];
  collapsed: boolean;
  players: string[];
  onLanguage: (language: Language) => void;
  onDismiss: () => void;
  onFollow: (player: string) => void;
  onJump: () => void;
  onKeepWatching: () => void;
  onExpand: () => void;
};

export function MatchExperience(props: Props) {
  const {
    phase, events, missed, elapsedSeconds, gapSeconds, runsMissed, liveScore, offline, language, stallStartClock,
    followed, collapsed, players, onLanguage, onDismiss, onFollow, onJump, onKeepWatching, onExpand, sport, renderEvent, recapLiveClock, recapVideoClock,
  } = props;
  const [mode, setMode] = useState<Mode>('everything');
  const latest = events[events.length - 1];
  const latestIsPreStall = latest !== undefined && stallStartClock !== undefined && latest.t < stallStartClock;
  const recent = events.slice(0, -1).slice(-5).reverse();
  const eventLabel = (event: MatchEvent) => event.text[language];
  const userPlayers = players.filter(player => followed.includes(player));
  const interruption = phase !== 'recap';
  const recapHighlight = [...missed].reverse().find(event => event.importance >= 3) || missed[missed.length - 1];

  if (phase === 'recap' && collapsed) {
    return <section className="match-experience recap-collapsed" aria-label="Recovery recap">
      <span>{formatDuration(gapSeconds)} behind live</span>
      <button className="recap-expand" onClick={onExpand}>Review recap</button>
      <button className="jump-live" onClick={onJump}>Jump to live</button>
    </section>;
  }

  return <section className={`match-experience ${phase === 'recap' ? 'experience-recap' : phase === 'recovering' ? 'experience-recovering' : 'experience-stalled'}`} data-recap-live-clock={phase === 'recap' ? recapLiveClock : undefined} data-recap-video-clock={phase === 'recap' ? recapVideoClock : undefined} role="status" aria-live="polite" aria-label={phase === 'recap' ? 'Match recovery recap' : phase === 'recovering' ? 'Confirming video recovery' : 'Match event channel while video is stalled'}>
    <header className="experience-head">
      <span className={phase === 'stalled' ? 'stall-dot' : 'recovered-dot'} />
      <strong>{phase === 'stalled' ? 'STALLED' : phase === 'recovering' ? 'RECOVERING' : 'RECAP'}</strong>
      {interruption ? <time className="experience-timer" aria-hidden="true">{formatDuration(elapsedSeconds)}</time> : <span className="experience-timer">{formatDuration(gapSeconds)} behind live</span>}
      {phase === 'stalled' && <button className="experience-dismiss" onClick={onDismiss} aria-label="Dismiss event sheet">×</button>}
    </header>

    {interruption && offline ? <div className="offline-card">
      <strong>You’re offline.</strong>
      <span>The match is still running.</span>
      <span>We’ll catch you up when you’re back.</span>
      <small>Local replay events continue; live delivery isn’t connected in this demo.</small>
    </div> : interruption ? mode === 'back' ? <p className="quiet-catchup">{phase === 'recovering' ? 'Checking the picture is back.' : 'Catching you up when it’s back.'}</p> : <>
      <div className="experience-score"><span>LIVE {liveScore.display?.context || liveScore.overs}</span><strong>{liveScore.display?.value || <>{liveScore.runs}<i>/{liveScore.wkts}</i></>}</strong></div>
      {phase === 'recovering' && <p className="quiet-catchup recovering-note">Picture back · confirming signal.</p>}
      <div className="experience-feed">
        {latest ? <article key={latest.id} className={`latest-event ${latest.type}`}>
          <div className="latest-event-top"><span>{latestIsPreStall ? 'LAST KEY EVENT · BEFORE STALL' : `${latest.score.overs} · ${latest.type.toUpperCase().replace('_', ' ')}`}</span>{userPlayers.some(player => latest.players.includes(player)) && <b>Your player</b>}</div>
          <strong><EventGlyph icon={renderEvent(latest).icon}/>{eventLabel(latest)}</strong>
        </article> : <div className="experience-waiting">Local replay · waiting for next key event</div>}
        {recent.length > 0 && <div className="recent-events" aria-label="Recent match events">
          {recent.map(event => <article className={`recent-event ${event.type}`} key={event.id}>
            <span className="recent-over">{event.score.overs}</span>
            <strong><EventGlyph icon={renderEvent(event).icon}/>{eventLabel(event)}</strong>
            <span className="recent-score">{event.score.display?.value || `${event.score.runs}/${event.score.wkts}`}</span>
            {userPlayers.some(player => event.players.includes(player)) && <i aria-label="Followed player involved" />}
          </article>)}
        </div>}
      </div>
    </> : <>
      <div className="recap-heading"><strong className="recap-title">Back. You missed {Math.round(gapSeconds)}s.</strong>
        <p className="recap-summary">{recapHighlight ? <>Key moment · {eventLabel(recapHighlight)}</> : 'No key events fell in this gap.'}</p>
        <div className="recap-chips">{recapChips(missed, runsMissed, sport).map(chip => <span key={chip}>{chip}</span>)}</div>
      </div>
      <details className="recap-timeline">
        <summary>Missed timeline · {missed.length} key events</summary>
        <div>{missed.filter(event => event.importance >= 2).map(event => <article className={event.type} key={event.id}><time>{event.score.display?.context || event.score.overs}</time><span><EventGlyph icon={renderEvent(event).icon}/>{eventLabel(event)}</span>{followed.some(player => event.players.includes(player)) && <b>Your player</b>}</article>)}</div>
      </details>
      <div className="recap-actions"><button className="keep-watching" onClick={onKeepWatching}>Keep watching from here</button><button className="jump-live" onClick={onJump}>Jump to live</button></div>
    </>}

    {interruption && <footer className="experience-footer">
      <div className="experience-modes" aria-label="Event detail preference">
        <button className={mode === 'everything' ? 'selected' : ''} onClick={() => setMode('everything')}>Tell me everything</button>
        <button className={mode === 'back' ? 'selected' : ''} onClick={() => setMode('back')}>Tell me when it’s back</button>
      </div>
      <div className="experience-locale" aria-label="Language">
        <button className={language === 'en' ? 'selected' : ''} onClick={() => onLanguage('en')}>EN</button>
        <button className={language === 'hi' ? 'selected' : ''} onClick={() => onLanguage('hi')}>हिन्दी · proofread</button>
      </div>
      <div className="follow-row">
        <label htmlFor="follow-player">Follow</label>
        <select id="follow-player" value="" onChange={event => event.target.value && onFollow(event.target.value)} aria-label="Choose a player to follow">
          <option value="">Choose player</option>{players.map(player => <option key={player} value={player} disabled={followed.length >= 3 && !followed.includes(player)}>{player}{followed.includes(player) ? ' · following' : ''}</option>)}
        </select>
        {followed.map(player => <button key={player} className="follow-chip" onClick={() => onFollow(player)} aria-label={`Unfollow ${player}`}>{player} ×</button>)}
      </div>
    </footer>}
  </section>;
}

function recapChips(events: MatchEvent[], runsMissed: number, sport: Sport): string[] {
  const chips: string[] = [];
  const count = (type: string) => events.filter(event => event.type === type).length;
  if (sport === 'football') {
    const goals = count('goal') + events.filter(event => event.type === 'penalty' && /GOAL/.test(event.text.en)).length;
    const saved = count('shot_saved'); const cards = count('card'); const subs = count('substitution'); const varReviews = count('var');
    if (goals) chips.push(`${goals} ${goals === 1 ? 'goal' : 'goals'}`);
    if (saved) chips.push(`${saved} saved`);
    if (cards) chips.push(`${cards} ${cards === 1 ? 'card' : 'cards'}`);
    if (subs) chips.push(`${subs} ${subs === 1 ? 'sub' : 'subs'}`);
    if (varReviews) chips.push(`${varReviews} VAR`);
    return chips;
  }
  if (sport === 'f1') {
    const safetyCars = count('safety_car'); const pits = count('pit_stop'); const positionChanges = count('position_change'); const retirements = count('retirement'); const fastest = count('fastest_lap');
    if (safetyCars) chips.push(`${safetyCars} ${safetyCars === 1 ? 'safety car' : 'safety cars'}`);
    if (pits) chips.push(`${pits} ${pits === 1 ? 'pit stop' : 'pit stops'}`);
    if (positionChanges) chips.push(`${positionChanges} position changes`);
    if (fastest) chips.push('Fastest lap');
    if (retirements) chips.push(`${retirements} ${retirements === 1 ? 'retirement' : 'retirements'}`);
    return chips;
  }
  const wickets = events.filter(event => event.type === 'wicket').length;
  const sixes = events.filter(event => event.type === 'six').length;
  const fours = events.filter(event => event.type === 'four').length;
  const over = events.find(event => event.type === 'over_end');
  if (wickets) chips.push(`${wickets} ${wickets === 1 ? 'wicket' : 'wickets'}`);
  if (runsMissed) chips.push(`${runsMissed} runs`);
  if (sixes) chips.push(`${sixes} ${sixes === 1 ? 'six' : 'sixes'}`);
  if (fours) chips.push(`${fours} ${fours === 1 ? 'four' : 'fours'}`);
  if (over) chips.push(`Over ${over.score.overs.split('.')[0]} done`);
  return chips;
}

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
