import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cricketDemoJson from '../data/cricket-demo.json';
import footballDemoJson from '../data/football-demo.json';
import f1DemoJson from '../data/f1-demo.json';
import { createCricketAdapter, createFootballAdapter, createF1Adapter, type Adapter } from '../data/adapters';
import type { CricketDemo, MatchEvent, Sport, SportDemo } from '../data/types';
import { EventBus } from '../engine/eventBus';
import { clockSnapshot, eventsOnFeed, eventsVisibleOnVideo, missedEvents } from '../engine/clocks';
import type { FreezeDetectorEvent, FreezeState } from '../engine/freezeDetector';
import type { PlayerController, PlayerStatus } from '../engine/usePlayer';
import { MatchExperience } from './MatchExperience';
import { Player } from './Player';
import { EventGlyph } from './EventGlyph';

const cricketDemo = cricketDemoJson as unknown as CricketDemo;
const footballDemo = footballDemoJson as unknown as SportDemo;
const f1Demo = f1DemoJson as unknown as SportDemo;
const demoCatalog: Record<Sport, SportDemo> = { cricket: cricketDemo, football: footballDemo, f1: f1Demo };
const videoCatalog: Record<Sport, { source: string; poster: string; label: string; credit: string }> = {
  cricket: { source: '/media/index.m3u8', poster: '/media/poster.jpg', label: 'Cricket', credit: 'Pexels · Hindustani Lens' },
  football: { source: '/media/football/index.m3u8', poster: '/media/football/poster.jpg', label: 'Football', credit: 'Pexels · Tio Nazih' },
  f1: { source: '/media/f1/index.m3u8', poster: '/media/f1/poster.jpg', label: 'Formula 1', credit: 'Wikimedia Commons · Rubin16 · 2021 Russian GP warm-up' },
};
const adapterCatalog: Record<Sport, Adapter> = {
  cricket: createCricketAdapter(cricketDemo.events),
  football: createFootballAdapter(footballDemo.events),
  f1: createF1Adapter(f1Demo.events),
};
type Language = 'en' | 'hi';
type Recap = { events: MatchEvent[]; gapSeconds: number; runs: number; liveScore: MatchEvent['score']; liveClock: number; videoClock: number };

function Icon({ name, size = 16 }: { name: 'wifi' | 'signal' | 'clock' | 'play' | 'pause' | 'rotate' | 'radio'; size?: number }) {
  const paths = {
    wifi: <><path d="M5 9a11 11 0 0 1 14 0"/><path d="M8 12a6.5 6.5 0 0 1 8 0"/><path d="M11 15a2 2 0 0 1 2 0"/><path d="M12 19h.01"/></>,
    signal: <><path d="M2 20h20"/><path d="M5 20v-4M10 20V11M15 20V7M20 20V3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    play: <path d="m7 4 13 8-13 8z" fill="currentColor" stroke="none"/>,
    pause: <><path d="M8 5h3v14H8z" fill="currentColor" stroke="none"/><path d="M15 5h3v14h-3z" fill="currentColor" stroke="none"/></>,
    rotate: <><path d="M20 7v5h-5"/><path d="M4.7 9A8 8 0 0 1 18 6l2 6M4 17v-5h5"/><path d="M19.3 15A8 8 0 0 1 6 18l-2-6"/></>,
    radio: <><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function App() {
  const bus = useMemo(() => new EventBus<MatchEvent>(), []);
  const livePositionRef = useRef(0);
  const videoPositionRef = useRef(0);
  const matchClockStarted = useRef(false);
  const lastTickRef = useRef(performance.now());
  const publishedIndex = useRef(0);
  const lastVideoBytes = useRef(0);
  const previousPlayerStatus = useRef<PlayerStatus>('idle');
  const recoveryCaptured = useRef(false);
  const activeStallClock = useRef(0);
  const autoTimer = useRef<number | null>(null);
  const restoreTimer = useRef<number | null>(null);
  const autoScheduled = useRef(false);
  const autoUsed = useRef(false);
  const autoCancelled = useRef(false);
  const hapticEvents = useRef(new Set<string>());
  const [controller, setController] = useState<PlayerController | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [freezeState, setFreezeState] = useState<FreezeState>('playing');
  const [speed, setSpeed] = useState(1);
  const [livePosition, setLivePosition] = useState(0);
  const [videoPosition, setVideoPosition] = useState(0);
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [feedEvents, setFeedEvents] = useState<MatchEvent[]>([]);
  const [feedTraceSeed, setFeedTraceSeed] = useState(0);
  const [videoTraceSeed, setVideoTraceSeed] = useState(0);
  const [stallStartedAt, setStallStartedAt] = useState<number | null>(null);
  const [stallElapsed, setStallElapsed] = useState(0);
  const [sheetVisible, setSheetVisible] = useState(true);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [recapCollapsed, setRecapCollapsed] = useState(false);
  const [behindLabel, setBehindLabel] = useState('');
  const [pulseLive, setPulseLive] = useState(false);
  const [autoLabel, setAutoLabel] = useState(false);
  const [autoRestoreSeconds, setAutoRestoreSeconds] = useState(5);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const [language, setLanguage] = useState<Language>(() => {
    try { return localStorage.getItem('keepalive-language') === 'hi' ? 'hi' : 'en'; } catch { return 'en'; }
  });
  const [followed, setFollowed] = useState<string[]>([]);
  const [sport, setSport] = useState<'cricket' | 'football' | 'f1'>('cricket');
  const [directorOpen, setDirectorOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  const [stallsThisMatch, setStallsThisMatch] = useState(0);
  const [totalMissedWickets, setTotalMissedWickets] = useState(0);
  const [simulatedOpen, setSimulatedOpen] = useState(false);
  const demo = demoCatalog[sport];
  const video = videoCatalog[sport];
  const activeAdapter = adapterCatalog[sport];
  const matchEvents = useMemo(() => activeAdapter.load(), [activeAdapter]);

  useEffect(() => bus.subscribe(event => {
    setFeedEvents(previous => previous.some(item => item.id === event.id) ? previous : [...previous, event]);
    setFeedTraceSeed(seed => seed + 1);
  }), [bus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.max(0, now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      if (!matchClockStarted.current) return;
      const position = livePositionRef.current + delta * speed;
      livePositionRef.current = position;
      setLivePosition(position);
      while (publishedIndex.current < matchEvents.length && matchEvents[publishedIndex.current].t <= position) {
        bus.publish(matchEvents[publishedIndex.current]);
        publishedIndex.current += 1;
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [bus, speed, matchEvents]);

  useEffect(() => {
    const offlineHandler = () => setOffline(true);
    const onlineHandler = () => setOffline(false);
    window.addEventListener('offline', offlineHandler);
    window.addEventListener('online', onlineHandler);
    return () => { window.removeEventListener('offline', offlineHandler); window.removeEventListener('online', onlineHandler); };
  }, []);

  useEffect(() => {
    if (status !== 'stalled' || stallStartedAt === null) return;
    const timer = window.setInterval(() => setStallElapsed(Math.max(0, (Date.now() - stallStartedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [status, stallStartedAt]);

  useEffect(() => {
    if (status !== 'stalled') return;
    restoreTimer.current = window.setTimeout(() => controller?.restoreNetwork(), autoRestoreSeconds * 1000);
    return () => {
      if (restoreTimer.current !== null) window.clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    };
  }, [status, autoRestoreSeconds, controller]);

  const readLiveClock = useCallback(() => livePositionRef.current, []);
  const playerReady = useCallback((player: PlayerController) => setController(player), []);
  const captureRecap = useCallback((liveClock: number, videoClock: number, countWickets = true) => {
    const events = missedEvents(matchEvents, liveClock, videoClock);
    const videoScoreEvent = [...matchEvents].reverse().find(item => item.t <= videoClock);
    const liveScoreEvent = [...matchEvents].reverse().find(item => item.t <= liveClock);
    const sameInnings = videoScoreEvent?.id.slice(0, 3) === liveScoreEvent?.id.slice(0, 3);
    const runs = Math.max(0, (liveScoreEvent?.score.runs || 0) - (sameInnings ? videoScoreEvent?.score.runs || 0 : 0));
    const gapSeconds = Math.max(0, liveClock - videoClock);
    setRecap({ events, gapSeconds, runs, liveScore: liveScoreEvent?.score || { runs: 0, wkts: 0, overs: '0.0' }, liveClock, videoClock });
    setRecapCollapsed(false);
    if (countWickets) setTotalMissedWickets(count => count + events.filter(item => item.type === 'wicket').length);
    recoveryCaptured.current = true;
  }, [matchEvents]);
  const statusChanged = useCallback((next: PlayerStatus) => {
    if (next === 'playing') matchClockStarted.current = true;
    if (next === 'stalled') recoveryCaptured.current = false;
    if (previousPlayerStatus.current === 'stalled' && next === 'playing' && !recoveryCaptured.current) {
      captureRecap(livePositionRef.current, videoPositionRef.current);
    }
    previousPlayerStatus.current = next;
    setStatus(next);
  }, [captureRecap]);
  const playerMetrics = useCallback((metrics: { videoTime: number; bufferedAhead: number; measuredBitrateKbps: number; loadedVideoBytes: number }) => {
    setVideoPosition(metrics.videoTime);
    videoPositionRef.current = metrics.videoTime;
    setBitrateKbps(metrics.measuredBitrateKbps);
    if (metrics.loadedVideoBytes > lastVideoBytes.current) {
      lastVideoBytes.current = metrics.loadedVideoBytes;
      setVideoTraceSeed(seed => seed + 1);
    }
  }, []);

  const onFreezeEvent = useCallback((event: FreezeDetectorEvent) => {
    setFreezeState(event.state);
    if (event.state === 'stalled' && event.stall) {
      activeStallClock.current = event.stall.clocksAtStart.liveClock;
      setStallStartedAt(event.stall.startedAt);
      setStallElapsed(Math.max(0, (Date.now() - event.stall.startedAt) / 1000));
      setSheetVisible(true);
      setRecap(null);
      setRecapCollapsed(false);
      setStallsThisMatch(count => count + 1);
      recoveryCaptured.current = false;
    }
    if (event.state === 'recovered' && event.stall?.clocksAtEnd) {
      const { videoClock, liveClock } = event.stall.clocksAtEnd;
      captureRecap(liveClock, videoClock, !recoveryCaptured.current);
      setStallStartedAt(null);
      setAutoLabel(false);
      if (restoreTimer.current !== null) window.clearTimeout(restoreTimer.current);
    }
  }, [captureRecap]);

  const clocks = clockSnapshot(livePosition, videoPosition);
  const videoEvents = useMemo(() => eventsVisibleOnVideo(matchEvents, clocks.videoClock), [clocks.videoClock]);
  const feedAtLive = useMemo(() => eventsOnFeed(feedEvents, clocks.liveClock), [feedEvents, clocks.liveClock]);
  const missed = useMemo(() => missedEvents(feedAtLive, clocks.liveClock, clocks.videoClock), [feedAtLive, clocks.liveClock, clocks.videoClock]);
  const popupEvents = feedAtLive.filter(event => event.importance >= 2);
  const currentStallEvents = useMemo(() => {
    const fromClock = activeStallClock.current;
    return popupEvents.filter(event => event.t >= fromClock);
  }, [popupEvents]);
  const liveScoreEvent = feedAtLive[feedAtLive.length - 1];
  const videoScoreEvent = videoEvents[videoEvents.length - 1];
  const liveScore = liveScoreEvent?.score || { runs: 0, wkts: 0, overs: '0.0' };
  const videoDisplay = videoScoreEvent?.score.display;
  const scorebug = videoDisplay
    ? { team: videoDisplay.label, runs: videoScoreEvent?.score.runs || 0, wkts: videoScoreEvent?.score.wkts || 0, overs: videoScoreEvent?.score.overs || '—', value: videoDisplay.value, context: videoDisplay.context }
    : sport === 'football'
      ? { team: demo.match.teams.map(team => team.slice(0, 3).toUpperCase()).join(' V '), runs: 0, wkts: 0, overs: "0'", value: '0–0', context: "0'" }
      : sport === 'f1'
        ? { team: 'F1', runs: 0, wkts: 0, overs: 'LAP 0', value: 'GRID', context: 'START' }
    : {
      team: teamCode(videoScoreEvent ? videoScoreEvent.text.en.split(' · ')[0] : demo.match.teams[0] || ''),
      runs: videoScoreEvent?.score.runs || 0,
      wkts: videoScoreEvent?.score.wkts || 0,
      overs: videoScoreEvent?.score.overs || '0.0',
    };

  useEffect(() => {
    if (status !== 'stalled') return;
    const newestWicket = [...currentStallEvents].reverse().find(event => event.type === 'wicket');
    if (!newestWicket || hapticEvents.current.has(newestWicket.id)) return;
    hapticEvents.current.add(newestWicket.id);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(35);
  }, [status, currentStallEvents]);

  useEffect(() => {
    if (status !== 'stalled') return;
    const latestWicket = [...currentStallEvents].reverse().find(event => event.type === 'wicket');
    setAssertiveText(latestWicket ? latestWicket.text.en : '');
  }, [currentStallEvents, status]);

  const [assertiveText, setAssertiveText] = useState('');
  const firstInteraction = () => {
    if (autoScheduled.current || autoUsed.current) return;
    autoScheduled.current = true;
    setAutoLabel(true);
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = null;
      if (autoCancelled.current || autoUsed.current || status === 'stalled') return;
      autoUsed.current = true;
      setAutoLabel(false);
      beginBreak(true);
    }, 25_000);
  };
  const clearTimers = () => {
    if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
    if (restoreTimer.current !== null) window.clearTimeout(restoreTimer.current);
    autoTimer.current = null;
    restoreTimer.current = null;
    setAutoLabel(false);
  };
  const beginBreak = (automated = false) => {
    autoCancelled.current = !automated;
    if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
    autoTimer.current = null;
    setAutoLabel(false);
    controller?.breakNetwork();
  };
  const restore = () => { clearTimers(); controller?.restoreNetwork(); };
  const jumpToLive = () => {
    controller?.jumpToLive(livePositionRef.current);
    setRecap(null);
    setRecapCollapsed(false);
    setBehindLabel('');
    setPulseLive(true);
    window.setTimeout(() => setPulseLive(false), 1_100);
  };
  const keepWatching = () => {
    setBehindLabel(formatDuration(recap?.gapSeconds || 0));
    setRecapCollapsed(true);
  };
  const toggleFollow = (player: string) => setFollowed(current => current.includes(player)
    ? current.filter(item => item !== player)
    : current.length < 3 ? [...current, player] : current);
  const changeLanguage = (next: Language) => {
    setLanguage(next);
    try { localStorage.setItem('keepalive-language', next); } catch { /* storage can be disabled */ }
  };

  const feedBytes10s = feedAtLive.filter(event => event.t > clocks.liveClock - 10).reduce((sum, event) => sum + event.bytes, 0);
  const feedRateKBps = feedBytes10s / 10 / 1000;
  const videoRateKBps = bitrateKbps / 8;
  const bandwidthRatio = feedRateKBps > 0 ? Math.max(1, Math.round(videoRateKBps / feedRateKBps)) : 0;
  const followPlayers = useMemo(() => [...new Set(matchEvents.flatMap(event => event.players))].sort(), [matchEvents]);
  const playerExperience = (freezeState === 'stalled' || freezeState === 'recovering') && sheetVisible
      ? <MatchExperience phase={freezeState === 'recovering' ? 'recovering' : 'stalled'} events={currentStallEvents} missed={missed} elapsedSeconds={stallElapsed} gapSeconds={clocks.lag} runsMissed={0} liveScore={liveScore} sport={sport} renderEvent={event => activeAdapter.render(event)} offline={offline && freezeState !== 'recovering'} language={language} followed={followed} collapsed={false} players={followPlayers} onLanguage={changeLanguage} onDismiss={() => setSheetVisible(false)} onFollow={toggleFollow} onJump={jumpToLive} onKeepWatching={keepWatching} onExpand={() => setRecapCollapsed(false)} />
    : recap && freezeState !== 'stalled' && freezeState !== 'recovering'
      ? <MatchExperience phase="recap" events={[]} missed={recap.events} elapsedSeconds={0} gapSeconds={recap.gapSeconds} runsMissed={recap.runs} liveScore={recap.liveScore} recapLiveClock={recap.liveClock} recapVideoClock={recap.videoClock} sport={sport} renderEvent={event => activeAdapter.render(event)} offline={false} language={language} followed={followed} collapsed={recapCollapsed} players={followPlayers} onLanguage={changeLanguage} onDismiss={() => setRecap(null)} onFollow={toggleFollow} onJump={jumpToLive} onKeepWatching={keepWatching} onExpand={() => setRecapCollapsed(false)} />
      : null;

  const restart = (switchingSport = false) => {
    clearTimers();
    livePositionRef.current = 0;
    lastTickRef.current = performance.now();
    matchClockStarted.current = true;
    publishedIndex.current = 0;
    lastVideoBytes.current = 0;
    activeStallClock.current = 0;
    setLivePosition(0);
    setVideoPosition(0);
    videoPositionRef.current = 0;
    setFeedEvents([]);
    setFeedTraceSeed(0);
    setVideoTraceSeed(0);
    setRecap(null);
    setBehindLabel('');
    setStallsThisMatch(0);
    setTotalMissedWickets(0);
    setStallStartedAt(null);
    setStallElapsed(0);
    hapticEvents.current.clear();
    if (switchingSport) {
      setStatus('idle');
      setFreezeState('playing');
      setSheetVisible(true);
      previousPlayerStatus.current = 'idle';
      setController(null);
    } else {
      controller?.jumpToLive(0);
    }
  };
  const switchSport = (next: Sport) => {
    if (next === sport) return;
    setFollowed([]);
    setSport(next);
    restart(true);
  };

  return <main className="workspace" data-sport={sport} data-live-clock={livePosition.toFixed(2)} data-video-clock={videoPosition.toFixed(2)}>
    <section className="phone" aria-label="KeepAlive match player">
      <header className="appbar">
        <div className="brand"><span className="brand-mark"><i/><i/></span><span>KEEPALIVE</span></div>
        <div className="replay-tag"><span className="replay-dot"/> REPLAY DEMO</div>
        <span className="connection"><Icon name="wifi" size={16}/></span>
      </header>
      <div className="context-strip"><span>Replay demo</span><i/> {demo.match.teams.join(' v ')}, {demo.match.date.slice(0, 4)} <i/> data: {demo.source.provider}</div>
      <div className="assertive-announcement" role="alert" aria-live="assertive" aria-atomic="true">{assertiveText ? `Wicket. ${assertiveText}` : ''}</div>
      <Player key={sport} sourceUrl={video.source} posterUrl={video.poster} sportLabel={video.label} onPlayerReady={playerReady} onStatusChange={statusChanged} onMetricsChange={playerMetrics} onFreezeEvent={onFreezeEvent} freezeState={freezeState} offline={offline} scorebug={recap ? undefined : scorebug} getLiveClock={readLiveClock} experience={playerExperience} behindLabel={behindLabel} pulseLive={pulseLive} onFirstInteraction={firstInteraction}/>
      {autoLabel && <div className="demo-auto-label">Demo: simulating a stall in 25s</div>}

      <section className="two-lines" aria-label="Video and event connection traces">
        <div className="two-lines-head"><strong>TWO LINES</strong><span>INDEPENDENT SIGNALS</span></div>
        <div className="trace-head"><div className="trace-title"><span className={`trace-state video-key ${freezeState === 'stalled' ? 'stalled' : ''}`}/><span>VIDEO</span></div><svg className="trace-chart" viewBox="0 0 180 24" preserveAspectRatio="none" aria-label={freezeState === 'stalled' ? 'Video trace flatlined' : status === 'idle' ? 'Video signal idle' : 'Video signal active'}><path className={freezeState === 'stalled' ? 'trace-path stalled-path' : status === 'idle' ? 'trace-path idle-path' : 'trace-path video-path'} d={freezeState === 'stalled' || status === 'idle' ? 'M0 12 H180' : `M0 15 L12 14 L24 15 L36 ${7 + videoTraceSeed % 5} L48 15 L60 14 L72 15 L84 ${8 + videoTraceSeed % 4} L96 15 L108 14 L120 15 L132 ${7 + videoTraceSeed % 6} L144 15 L156 14 L168 15 L180 ${7 + videoTraceSeed % 5}`}/></svg><span className="trace-count">Video ~{bitrateKbps || '—'} kbps</span></div>
        <div className="trace-head"><div className="trace-title"><span className="trace-state feed-key"/><span>FEED</span></div><svg className="trace-chart" viewBox="0 0 180 24" preserveAspectRatio="none" aria-label={`Event feed active, ${feedTraceSeed} event ticks`}><path className="trace-path feed-path" d="M0 18 H180"/><path className="feed-ticks" d={feedTickPath(feedTraceSeed)}/></svg><span className="trace-count mint-count">Feed {feedRateKBps.toFixed(1)} KB/s</span></div>
        <div className="trace-foot"><span>VIDEO · {status === 'idle' ? 'IDLE' : freezeState.toUpperCase()}</span><span>EVENT CHANNEL · CONNECTED</span></div>
        <p className="bandwidth-caption">{bandwidthRatio && bitrateKbps > 0 ? `Matches events use ~1/${bandwidthRatio}th of the bandwidth.` : 'Bandwidth ratio appears when both channel rates are measured.'}</p>
      </section>

      <section className="events-section" aria-label={`${sport} match events`}>
        <div className="section-heading"><div><span className="feed-status-dot"/><h2>Live events</h2><span className="local-label">REPLAY DEMO</span></div><span className="event-counter">{String(feedAtLive.length).padStart(3, '0')} <span>/</span> {String(matchEvents.length).padStart(3, '0')}</span></div>
        {popupEvents.length === 0 && <div className="waiting-row"><span className="waiting-signal"><i/><i/><i/></span><span>Waiting for next key event</span><span className="mono">{formatClock(clocks.liveClock)}</span></div>}
        <div className="event-list" aria-live="polite">{[...popupEvents].slice(-8).reverse().map(event => <article className={`event-row ${event.type}`} key={event.id}><div className="event-over">{event.score.display?.context || event.score.overs}<small>{sport === 'f1' ? 'F1' : sport === 'football' ? 'MIN' : 'OV'}</small></div><div className="event-copy"><strong><EventGlyph icon={activeAdapter.render(event).icon}/>{event.text.en}</strong><span>{event.players.join(' · ')}</span></div><span className="event-bytes">{event.bytes} B</span></article>)}</div>
      </section>
      <footer className="app-credit">Video: {video.credit}{sport === 'f1' && <> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a></>} · illustrative, not synchronized · Match data: {demo.source.provider} · Replay demo{sport === 'football' && <a className="statsbomb-credit" href="https://statsbomb.com/" target="_blank" rel="noreferrer"><img src="/media/credits/statsbomb-mark.svg" alt="StatsBomb"/> StatsBomb Open Data</a>}</footer>
    </section>

    <aside className="director" aria-label="Director’s panel">
      <details className="director-details" open={directorOpen} onToggle={event => setDirectorOpen(event.currentTarget.open)}>
        <summary><span className="director-mark"><Icon name="signal" size={16}/></span><span className="director-summary-copy"><span className="director-label">DEMO CONTROLS</span><strong>Director’s panel</strong><small>Network · replay · data</small></span></summary>
        <div className="director-content">
          <div className="guide"><span>1</span><p>Press play.</p><span>2</span><p>Hit “Break the network” (or toggle Offline in DevTools).</p><span>3</span><p>Watch the feed take over, then restore.</p></div>
          <div className="control-block"><div className="control-caption"><span>VIDEO SIGNAL</span><span className={`control-state ${status}`}>{status === 'stalled' ? 'STALLED' : status.toUpperCase()}</span></div><button className="primary-control" onClick={() => status === 'stalled' ? restore() : beginBreak()} disabled={!controller}><span className="control-icon"><Icon name={status === 'stalled' ? 'rotate' : 'pause'} size={16}/></span><span>{status === 'stalled' ? 'Restore' : 'Break the network'}</span></button><div className="lag-readout"><span>LIVE / VIDEO LAG</span><strong className={clocks.lag > 0.5 ? 'lagging' : ''}>{clocks.lag.toFixed(1)}s</strong></div></div>
          <div className="control-block replay-controls"><div className="control-caption"><span>AUTO RESTORE AFTER STALL</span><span className="tiny-connected"><i/> LOCAL</span></div><div className="control-actions">{[5, 10, 20].map(seconds => <button className={`secondary-control ${autoRestoreSeconds === seconds ? 'selected' : ''}`} key={seconds} onClick={() => setAutoRestoreSeconds(seconds)}>{seconds}s</button>)}</div><div className="clock-readout"><span>LIVE <b>{formatClock(clocks.liveClock)}</b></span><span>VIDEO <b>{formatClock(clocks.videoClock)}</b></span></div><label className="speed-select">REPLAY SPEED<select value={speed} onChange={event => { lastTickRef.current = performance.now(); setSpeed(Number(event.target.value)); }} aria-label="Replay speed"><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button className="text-control" onClick={() => restart()}><Icon name="rotate" size={16}/> Restart replay</button></div>
          <div className="sport-select" aria-label="Sport adapter"><span>SPORT ADAPTER</span>{(['cricket', 'football', 'f1'] as const).map(item => <button key={item} className={sport === item ? 'selected' : ''} onClick={() => switchSport(item)}>{item === 'f1' ? 'F1' : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
          {sport !== 'cricket' && <p className="adapter-next">STATIC REPLAY LOADED</p>}
          <label className="follow-director"><span>FOLLOW · UP TO 3</span><select value="" onChange={event => event.target.value && toggleFollow(event.target.value)} aria-label="Follow a player"><option value="">Choose player</option>{followPlayers.map(player => <option key={player} value={player} disabled={followed.length >= 3 && !followed.includes(player)}>{player}{followed.includes(player) ? ' · following' : ''}</option>)}</select><small>{followed.join(' · ') || 'No players pinned'}</small></label>
          <details className="simulation-details" open={simulatedOpen} onToggle={event => setSimulatedOpen(event.currentTarget.open)}><summary>What’s simulated</summary><p>Licensed match footage loops for this demo; it is not synchronized to event timestamps.</p><p>Events replay real past-match data.</p><p>In production, the feed would ride the platform’s own lightweight channel.</p></details>
          {stallsThisMatch > 0 && <p className="stall-totals">Stalls this match: {stallsThisMatch} · total missed: {totalMissedWickets} wickets</p>}
          <div className="match-reference"><span>DATA CREDIT</span><strong>{demo.match.teams.join(' v ')}, {demo.match.date}</strong><small>{demo.match.event} · {demo.match.venue}</small><small>Event data: {demo.source.provider}</small>{sport === 'football' && <img className="statsbomb-mark" src="/media/credits/statsbomb-mark.svg" alt="StatsBomb"/>}<small>Video: {video.credit}{sport === 'f1' && <> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a></>} · not synchronized to events</small></div>
          <footer className="director-foot"><span><Icon name="clock" size={16}/> FEED EVENTS <b>{feedAtLive.length}</b></span><span>{missed.length} KEY MISSED</span></footer>
        </div>
      </details>
    </aside>
  </main>;
}

function teamCode(name: string) {
  if (name === 'India') return 'IND';
  if (name === 'South Africa') return 'SA';
  return name.split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase();
}
function formatClock(seconds: number) {
  const value = Math.floor(Math.max(0, seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function formatDuration(seconds: number) { return `${Math.floor(Math.max(0, seconds))}s`; }

function feedTickPath(count: number) {
  return Array.from({ length: Math.min(count, 20) }, (_, index) => {
    const x = 180 - ((index + 1) * 8);
    return `M${x} 18 v-8`;
  }).join(' ');
}
