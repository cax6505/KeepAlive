import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePlayer, type PlayerController, type PlayerStatus } from '../engine/usePlayer';
import type { FreezeDetectorEvent } from '../engine/freezeDetector';
import type { FreezeState } from '../engine/freezeDetector';

type Props = {
  onPlayerReady?: (player: PlayerController) => void;
  onCanBreakNetworkChange?: (canBreak: boolean) => void;
  sourceUrl: string;
  posterUrl: string;
  sportLabel: string;
  onStatusChange?: (status: PlayerStatus) => void;
  onMetricsChange?: (metrics: { videoTime: number; bufferedAhead: number; measuredBitrateKbps: number; loadedVideoBytes: number }) => void;
  scorebug?: { team: string; runs: number; wkts: number; overs: string; value?: string; context?: string };
  getLiveClock?: () => number;
  experience?: ReactNode;
  behindLabel?: string;
  pulseLive?: boolean;
  onFirstInteraction?: () => void;
  onFreezeEvent?: (event: FreezeDetectorEvent) => void;
  freezeState?: FreezeState;
  offline?: boolean;
};

function Glyph({ name }: { name: 'play' | 'pause' | 'volume' | 'mute' | 'expand' | 'retry' }) {
  const paths = {
    play: <path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none" />,
    pause: <><path d="M7 5h4v14H7z" fill="currentColor" stroke="none"/><path d="M14 5h4v14h-4z" fill="currentColor" stroke="none"/></>,
    volume: <><path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M16 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/></>,
    mute: <><path d="M4 10v4h4l5 4V6l-5 4z"/><path d="m17 9 5 6m0-6-5 6"/></>,
    expand: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3"/></>,
    retry: <><path d="M20 7v5h-5"/><path d="M4.7 9A8 8 0 0 1 18 6l2 6M4 17v-5h5"/><path d="M19.3 15A8 8 0 0 1 6 18l-2-6"/></>,
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Player({ onPlayerReady, onCanBreakNetworkChange, sourceUrl, posterUrl, sportLabel, onStatusChange, onMetricsChange, scorebug, getLiveClock, experience, behindLabel, pulseLive, onFirstInteraction, onFreezeEvent, freezeState = 'playing', offline = false }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);
  const player = usePlayer(getLiveClock, sourceUrl);
  const { videoRef, videoTime, bufferedAhead, status, isPaused, measuredBitrateKbps, loadedVideoBytes, hasFirstFrame, faultMode, error, freezeEvent } = player;

  useEffect(() => { onPlayerReady?.(player.controller); }, [onPlayerReady, player.controller]);
  useEffect(() => { onCanBreakNetworkChange?.(status === 'playing' && !isPaused); }, [onCanBreakNetworkChange, isPaused, status]);
  useEffect(() => { onStatusChange?.(status); }, [onStatusChange, status]);
  useEffect(() => { onMetricsChange?.({ videoTime, bufferedAhead, measuredBitrateKbps, loadedVideoBytes }); }, [onMetricsChange, videoTime, bufferedAhead, measuredBitrateKbps, loadedVideoBytes]);
  useEffect(() => { if (freezeEvent) onFreezeEvent?.(freezeEvent); }, [freezeEvent, onFreezeEvent]);
  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted; }, [muted, videoRef]);

  const stale = freezeState === 'stalled' || freezeState === 'recovering';
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !stale) return;
    const syncScorebugBaseline = () => {
      const bug = shell.querySelector<HTMLElement>('.video-scorebug');
      const videoScore = bug?.querySelector<HTMLElement>('strong');
      const liveScore = shell.querySelector<HTMLElement>('.experience-score strong');
      if (!bug || !videoScore || !liveScore) return;
      const bugBox = bug.getBoundingClientRect();
      const videoBox = videoScore.getBoundingClientRect();
      const liveBox = liveScore.getBoundingClientRect();
      const playerBox = shell.getBoundingClientRect();
      bug.style.top = `${liveBox.bottom - playerBox.top - (videoBox.bottom - bugBox.top)}px`;
    };
    syncScorebugBaseline();
    const observer = new ResizeObserver(syncScorebugBaseline);
    observer.observe(shell);
    const liveScore = shell.querySelector('.experience-score');
    if (liveScore) observer.observe(liveScore);
    return () => observer.disconnect();
  }, [stale, experience]);

  const fullscreen = () => {
    const target = shellRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
    if (target?.requestFullscreen) void target.requestFullscreen();
    else void target?.webkitRequestFullscreen?.();
  };
  const duration = videoRef.current?.duration || 360;
  const progress = Math.max(0, Math.min(100, videoTime / duration * 100));
  const statusText = freezeState === 'suspect' ? (offline ? 'OFFLINE' : 'CHECKING') : freezeState === 'stalled' ? 'PICTURE STALLED' : freezeState === 'recovering' ? 'RECOVERING' : status === 'ended' ? 'REPLAY ENDED' : status === 'playing' ? 'LIVE' : error ? 'NO SIGNAL' : 'CONNECTING';

  return <div className={`player player-shell status-${status} freeze-${freezeState}`} data-freeze-state={freezeState} data-video-source={sourceUrl} ref={shellRef} aria-label="Match video player" onPointerDown={onFirstInteraction}>
    <video
      ref={videoRef}
      className="match-video"
      playsInline
      muted
      autoPlay
      preload="auto"
      poster={posterUrl}
      aria-label={`${sportLabel} match footage`}
    />
    <div className="player-chrome-top">
      <span className={`state-label player-state ${status} ${freezeState} ${offline && freezeState === 'suspect' ? 'offline' : ''}`}><i/>{statusText}</span>
      <span className="bitrate-label">HLS <b>·</b> {formatBitrate(measuredBitrateKbps)}</span>
    </div>
    {scorebug && <div className={`video-scorebug ${stale ? 'stale' : ''}`} aria-label={`On-video score${stale ? ', stale' : ''}: ${scorebug.team} ${scorebug.value || `${scorebug.runs}/${scorebug.wkts}`} ${scorebug.context || scorebug.overs}`}><span>{scorebug.team}</span><strong>{scorebug.value || scorebug.runs}{!scorebug.value && <i className={scorebug.wkts > 0 ? 'wicket-count' : ''}>/{scorebug.wkts}</i>}</strong><small>{scorebug.context || `${scorebug.overs} OV`}</small>{stale && <em>VIDEO {scorebug.context || scorebug.overs}</em>}</div>}
    {(!hasFirstFrame || status === 'idle') && <div className="player-poster" role="status">
      <div className="poster-grid" aria-hidden="true"/><div className="signal-emblem" aria-hidden="true"><span/><span/><span/><span/><span/><span/><span/></div>
      <p>{error ? 'BROADCAST UNAVAILABLE' : status === 'playing' ? 'ACQUIRING FIRST FRAME' : `${sportLabel.toUpperCase()} · MATCH REPLAY`}</p>
      <button className="tap-start" onClick={error ? player.retry : player.play}>{error ? <Glyph name="retry"/> : <Glyph name="play"/>}<span>{error ? 'Retry stream' : 'Tap to start'}</span></button>
    </div>}
    {error && hasFirstFrame && <div className="player-error" role="alert"><strong>Signal lost</strong><span>{error}</span><button onClick={player.retry}><Glyph name="retry"/> Retry stream</button></div>}
    {experience}
    {status === 'ended' && <div className="ended-overlay" role="status"><strong>Replay complete</strong><button onClick={player.play}><Glyph name="retry"/> Play again</button></div>}
    <div className="player-chrome-bottom">
      <div className="player-controls">
        <button className="player-control" onClick={isPaused ? player.play : player.pause} aria-label={isPaused ? 'Play video' : 'Pause video'}><Glyph name={isPaused ? 'play' : 'pause'}/></button>
        <span className="player-time">{formatTime(videoTime)} <i>/</i> {formatTime(duration)}</span>
        <div className="player-spacer"/>
        {faultMode === 'simulated' && <span className="simulated-note">FAULT TEST · SIMULATED</span>}
        {behindLabel && <span className="behind-pill">{behindLabel} behind live</span>}
        {pulseLive && <span className="live-pulse">LIVE</span>}
        <button className="player-control" onClick={() => setMuted(v => !v)} aria-label={muted ? 'Unmute video' : 'Mute video'}><Glyph name={muted ? 'mute' : 'volume'}/></button>
        <button className="player-control" onClick={fullscreen} aria-label="Enter fullscreen"><Glyph name="expand"/></button>
      </div>
      <div className="player-progress" role="progressbar" aria-label="Video playback progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={`Buffered ${bufferedAhead.toFixed(1)} seconds; playback ${progress.toFixed(0)} percent`}><span style={{ width: `${progress}%` }}/></div>
    </div>
  </div>;
}

function formatTime(seconds: number) {
  const value = Math.floor(seconds || 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function formatBitrate(kbps: number) {
  if (!kbps) return '— KBPS';
  return kbps >= 10_000 ? `${Math.round(kbps / 1_000)} MBIT/S` : `${kbps} KBPS`;
}
