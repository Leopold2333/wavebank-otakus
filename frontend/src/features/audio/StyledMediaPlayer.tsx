import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Button, Slider } from 'antd';
import {
  MutedOutlined,
  PauseOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import playIconUrl from './play.svg';

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00:00';
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return [hours, minutes, rest].map((value) => String(value).padStart(2, '0')).join(':');
}

interface ProgressTrackProps {
  mediaRef: RefObject<HTMLMediaElement | null>;
  src: string;
}

const ProgressTrack = memo(function ProgressTrack({ mediaRef, src }: ProgressTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
  }, [src]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    };
    const handleTimeUpdate = () => {
      setCurrentTime(media.currentTime);
    };
    const handleProgress = () => {
      if (media.buffered.length > 0) {
        setBufferedEnd(media.buffered.end(media.buffered.length - 1));
      }
    };
    media.addEventListener('loadedmetadata', handleLoadedMetadata);
    media.addEventListener('timeupdate', handleTimeUpdate);
    media.addEventListener('progress', handleProgress);
    return () => {
      media.removeEventListener('loadedmetadata', handleLoadedMetadata);
      media.removeEventListener('timeupdate', handleTimeUpdate);
      media.removeEventListener('progress', handleProgress);
    };
  }, [mediaRef]);

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const media = mediaRef.current;
    const track = trackRef.current;
    if (!media || !track) {
      return;
    }
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    media.currentTime = ratio * (media.duration || 0);
    setCurrentTime(media.currentTime);
  };

  const seekByKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    if (event.key === 'ArrowRight') {
      media.currentTime = Math.min(media.duration || 0, media.currentTime + 5);
    } else if (event.key === 'ArrowLeft') {
      media.currentTime = Math.max(0, media.currentTime - 5);
    }
    setCurrentTime(media.currentTime);
  };

  const playedPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent =
    duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;

  return (
    <>
      <div
        ref={trackRef}
        className="styled-media-player__track"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={currentTime}
        tabIndex={0}
        onClick={seek}
        onKeyDown={seekByKey}
      >
        <div className="styled-media-player__fill">
          <div
            className="styled-media-player__buffered"
            style={{ width: `${bufferedPercent}%` }}
          />
          <div
            className="styled-media-player__played"
            style={{ width: `${playedPercent}%` }}
          />
        </div>
        <div
          className="styled-media-player__thumb"
          style={{ left: `${playedPercent}%` }}
        />
      </div>
      <span className="styled-media-player__time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </>
  );
});

interface StyledMediaPlayerProps {
  src: string;
  kind: 'audio' | 'video';
  variant?: 'input' | 'output';
}

export function StyledMediaPlayer({ src, kind, variant = 'input' }: StyledMediaPlayerProps) {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.3);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => {
    setPlaying(false);
    setVolume(0.3);
    setMuted(false);
    setControlsVisible(true);
  }, [src]);

  useEffect(() => {
    const media = mediaRef.current;
    if (media) {
      media.volume = volume;
      media.muted = muted;
    }
  }, [volume, muted, src]);

  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    if (media.paused) {
      void media.play();
    } else {
      media.pause();
    }
  }, []);

  const handleVolumeChange = useCallback((value: number | number[]) => {
    const next = Array.isArray(value) ? value[0] : value;
    const media = mediaRef.current;
    setVolume(next);
    setMuted(next === 0);
    if (media) {
      media.volume = next;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }
    const next = media.volume > 0 ? 0 : volume || 0.3;
    media.volume = next;
    setVolume(next);
    setMuted(next === 0);
  }, [volume]);

  return (
    <div
      className={`styled-media-player styled-media-player--${kind}${
        variant === 'output' ? ' styled-media-player--output' : ''
      }${kind === 'video' && !controlsVisible ? ' styled-media-player--controls-hidden' : ''}`}
      onMouseEnter={() => setControlsVisible(true)}
      onMouseLeave={() => setControlsVisible(false)}
      onFocus={() => setControlsVisible(true)}
      onClick={kind === 'video' ? togglePlay : undefined}
    >
      {kind === 'video' ? (
        <video
          ref={mediaRef as React.Ref<HTMLVideoElement>}
          src={src}
          preload="metadata"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      ) : (
        <audio
          ref={mediaRef as React.Ref<HTMLAudioElement>}
          src={src}
          preload="metadata"
          style={{ display: 'none' }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}

      <div
        className="styled-media-player__controls"
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          type="text"
          icon={
            playing ? (
              <PauseOutlined style={{ fontSize: 22 }} />
            ) : (
              <img
                src={playIconUrl}
                alt=""
                className="styled-media-player__play-icon"
                draggable={false}
              />
            )
          }
          onClick={togglePlay}
          aria-label={playing ? '暂停' : '播放'}
        />
        <ProgressTrack mediaRef={mediaRef} src={src} />
        <span
          className="styled-media-player__volume-icon"
          role="button"
          tabIndex={0}
          aria-label={muted ? '取消静音' : '静音'}
          onClick={toggleMute}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              toggleMute();
            }
          }}
        >
          {muted ? <MutedOutlined /> : <SoundOutlined />}
        </span>
        <Slider
          className="styled-media-player__volume"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={handleVolumeChange}
          tooltip={{
            formatter: (value) => `${Math.round((value ?? 0) * 100)}%`,
          }}
        />
      </div>
    </div>
  );
}
