import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { jumpToLive as seekToLive } from './clocks';
import { FreezeDetector, type FreezeDetectorEvent, type HlsEventSource } from './freezeDetector';

export type PlayerStatus = 'idle' | 'playing' | 'stalled' | 'ended';
export type FaultMode = 'network' | 'simulated';
export type PlayerController = {
  breakNetwork: () => void;
  restoreNetwork: () => void;
  jumpToLive: (livePosition: number) => number;
};

const SOURCE = '/media/index.m3u8';

export function usePlayer(getLiveClock: () => number = () => Date.now() / 1000) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const startedRef = useRef(false);
  const faultedRef = useRef(false);
  const bufferPausedRef = useRef(false);
  const recoveryLoadingRef = useRef(false);
  const resumeAtRef = useRef(0);
  const [videoTime, setVideoTime] = useState(0);
  const [bufferedAhead, setBufferedAhead] = useState(0);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [isPaused, setIsPaused] = useState(true);
  const [measuredBitrateKbps, setMeasuredBitrateKbps] = useState(0);
  const [loadedVideoBytes, setLoadedVideoBytes] = useState(0);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [faultMode, setFaultMode] = useState<FaultMode>('network');
  const [error, setError] = useState('');
  const [freezeEvent, setFreezeEvent] = useState<FreezeDetectorEvent | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let hls: Hls | null = null;
    let detector: FreezeDetector | null = null;
    let unsubscribeDetector: (() => void) | null = null;
    const attachDetector = (hlsInstance?: Hls) => {
      detector = new FreezeDetector(video, {
        hls: hlsInstance,
        getClocks: () => ({ videoClock: video.currentTime, liveClock: getLiveClock() }),
      });
      unsubscribeDetector = detector.subscribe(event => {
        setFreezeEvent(event);
        if (event.state === 'stalled') setStatus('stalled');
        else if (event.state === 'recovered') { recoveryLoadingRef.current = false; setStatus('playing'); }
        else if (event.state === 'playing' && !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setStatus('playing');
      });
      detector.start();
    };
    const onPlaying = () => {
      setIsPaused(false);
      startedRef.current = true;
      if (detector?.state === 'playing' || detector?.state === 'recovered') setStatus('playing');
      setError('');
    };
    const onFrame = () => setHasFirstFrame(true);
    const onEnded = () => setStatus('ended');
    const onPause = () => setIsPaused(true);
    const onError = () => setError('Local broadcast could not be opened. Retry the stream.');
    video.addEventListener('playing', onPlaying);
    video.addEventListener('loadeddata', onFrame);
    video.addEventListener('ended', onEnded);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onError);

    import('hls.js/light').then(({ default: HlsPlayer }) => {
      if (disposed) return;
      if (HlsPlayer.isSupported()) {
        const instance = new HlsPlayer({
          maxBufferLength: 6,
          maxMaxBufferLength: 8,
          backBufferLength: 10,
          lowLatencyMode: false,
        });
        hls = instance;
        hlsRef.current = instance;
        instance.on(HlsPlayer.Events.ERROR, (_event: string, data: import('hls.js').ErrorData) => {
          if (data.fatal) setError('Local HLS playback failed. Retry the stream.');
        });
        instance.on(HlsPlayer.Events.FRAG_LOADED, (_event: string, data: any) => {
          const stats = data?.frag?.stats;
          const loaded = Number(stats?.loaded || 0);
          const mediaDurationSeconds = Number(data?.frag?.duration || 0);
          if (loaded > 0) setLoadedVideoBytes(bytes => bytes + loaded);
          if (loaded > 0 && Number.isFinite(mediaDurationSeconds) && mediaDurationSeconds > 0) {
            // Segment bytes divided by media duration measures stream bitrate,
            // not localhost download speed (which can be hundreds of Mbps).
            const measured = Math.round((loaded * 8) / mediaDurationSeconds / 1_000);
            if (Number.isFinite(measured) && measured > 0) setMeasuredBitrateKbps(measured);
          }
        });
        instance.on(HlsPlayer.Events.FRAG_BUFFERED, () => {
          const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : video.currentTime;
          if (!faultedRef.current && !recoveryLoadingRef.current && !bufferPausedRef.current && startedRef.current && end - video.currentTime >= 0.35) {
            bufferPausedRef.current = true;
            instance?.stopLoad();
          }
        });
        instance.loadSource(SOURCE);
        instance.attachMedia(video);
        attachDetector(instance);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        setFaultMode('simulated');
        video.src = SOURCE;
        video.load();
        attachDetector();
      } else {
        setError('This browser cannot play the local HLS stream.');
      }
    }).catch(() => setError('The HLS player did not load. Retry the page.'));

    const timer = window.setInterval(() => {
      const current = video.currentTime;
      setVideoTime(current || 0);
      let ahead = 0;
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (video.buffered.start(i) <= current + 0.15 && video.buffered.end(i) >= current) {
          ahead = Math.max(0, video.buffered.end(i) - current);
          break;
        }
      }
      setBufferedAhead(ahead);
      if (hlsRef.current && startedRef.current && !recoveryLoadingRef.current && !bufferPausedRef.current && !faultedRef.current && ahead >= 0.35) {
        bufferPausedRef.current = true;
        hlsRef.current.stopLoad();
      } else if (hlsRef.current && bufferPausedRef.current && !faultedRef.current && ahead <= 0.15) {
        bufferPausedRef.current = false;
        hlsRef.current.startLoad(current);
      }
    }, 250);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      unsubscribeDetector?.();
      detector?.stop();
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('loadeddata', onFrame);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
      hls?.destroy();
      hlsRef.current = null;
    };
  }, []);

  const breakNetwork = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    resumeAtRef.current = video.currentTime;
    if (hlsRef.current) {
      // Hold real fragment requests. The existing decoded buffer drains naturally,
      // then the media element emits waiting/stalled for FreezeDetector.
      faultedRef.current = true;
      bufferPausedRef.current = false;
      hlsRef.current.stopLoad();
    } else {
      setFaultMode('simulated');
      video.pause();
      setStatus('stalled');
    }
  }, []);

  const restoreNetwork = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) {
      faultedRef.current = false;
      bufferPausedRef.current = false;
      recoveryLoadingRef.current = true;
      hlsRef.current.startLoad(resumeAtRef.current);
    } else {
      setFaultMode('simulated');
      setStatus('playing');
      void video.play().catch(() => setStatus('idle'));
    }
  }, []);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (status === 'ended') video.currentTime = 0;
    if (hlsRef.current && status === 'ended') hlsRef.current.startLoad(0);
    void video.play().catch(() => setStatus('idle'));
  }, [status]);

  const pause = useCallback(() => videoRef.current?.pause(), []);
  const retry = useCallback(() => {
    setError('');
    if (hlsRef.current) {
      hlsRef.current.stopLoad();
      hlsRef.current.startLoad(videoRef.current?.currentTime || 0);
    } else if (videoRef.current) {
      videoRef.current.load();
      void videoRef.current.play().catch(() => {});
    }
  }, []);

  const jumpToLive = useCallback((livePosition: number) => {
    const video = videoRef.current;
    if (!video) return 0;
    const target = seekToLive(video, livePosition);
    faultedRef.current = false;
    bufferPausedRef.current = false;
    hlsRef.current?.startLoad(target);
    void video.play().catch(() => setStatus('idle'));
    return target;
  }, []);

  const controller = useMemo<PlayerController>(() => ({ breakNetwork, restoreNetwork, jumpToLive }), [breakNetwork, restoreNetwork, jumpToLive]);
  return { videoRef, videoTime, bufferedAhead, status, isPaused, measuredBitrateKbps, loadedVideoBytes, hasFirstFrame, faultMode, error, freezeEvent, play, pause, retry, breakNetwork, restoreNetwork, jumpToLive, controller };
}
