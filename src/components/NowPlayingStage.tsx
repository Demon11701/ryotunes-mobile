import React, { useState } from 'react';
import { fmtTime, useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';
import { Backdrop } from './Backdrop';
import { DotMatrixSpectrum } from './DotMatrixSpectrum';
import { LyricsView } from './LyricsView';
import { OfflineButton } from './OfflineButton';
import { ProviderBadge } from './ProviderBadge';
import { QueueSheet } from './QueueSheet';
import { SeekbarControl } from './SeekbarControl';
import { SpectrumCanvas } from './SpectrumCanvas';

interface NowPlayingStageProps {
  open: boolean;
  onClose: () => void;
  onOpenSound: () => void;
}

/**
 * Mobile-first full-screen Now Playing stage (port of chrome/NowPlaying.qml).
 */
export const NowPlayingStage: React.FC<NowPlayingStageProps> = ({
  open,
  onClose,
  onOpenSound,
}) => {
  const {
    currentTrack,
    isPlaying,
    position,
    duration,
    shuffle,
    repeat,
    spectrumPoints,
    likedIds,
    togglePlay,
    next,
    prev,
    seek,
    toggleShuffle,
    cycleRepeat,
    toggleLike,
    triggerOsd,
  } = useAudio();

  const { visualizerStyle } = useTheme();
  const [tab, setTab] = useState<'stage' | 'lyrics' | 'queue'>('stage');
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null);

  if (!open || !currentTrack) return null;

  const liked = likedIds.includes(currentTrack.id);
  const fraction = duration > 0 ? position / duration : 0;
  const provLabel = (currentTrack.provider || currentTrack.source || 'RYOTUNES').toUpperCase();

  const handleArtTap = () => {
    setFlash(isPlaying ? 'pause' : 'play');
    window.setTimeout(() => setFlash(null), 320);
    togglePlay();
  };

  return (
    <div
      className="sheet-rise"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        backgroundColor: 'var(--paper)',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 'calc(var(--safe-top) + 10px)',
        paddingBottom: 'calc(var(--safe-bottom) + 12px)',
        paddingLeft: 'calc(var(--safe-left) + 16px)',
        paddingRight: 'calc(var(--safe-right) + 16px)',
        overflow: 'hidden',
      }}
    >
      <Backdrop artwork={currentTrack.artwork} strength={0.32} focusX={50} focusY={24} />

      {/* Header Row */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
            {provLabel} · NOW PLAYING
          </span>
          <ProviderBadge track={currentTrack} compact />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="ryo-pressable"
          style={{
            height: 32,
            padding: '0 14px',
            borderRadius: 999,
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line)',
            color: 'var(--ink-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <span>Collapse</span>
          <Icon name="chevron-down" size={16} color="var(--ink-dim)" />
        </button>
      </div>

      {/* Mode Switch Tabs (Art Stage | Lyrics | Queue) */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          gap: 6,
          padding: 4,
          borderRadius: 'var(--radius)',
          backgroundColor: 'var(--paper-lift)',
          border: '1px solid var(--line-soft)',
          marginBottom: 12,
        }}
      >
        {(
          [
            { k: 'stage', l: 'Stage' },
            { k: 'lyrics', l: 'Lyrics' },
            { k: 'queue', l: 'Queue' },
          ] as const
        ).map((t) => {
          const active = tab === t.k;
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              style={{
                flex: 1,
                height: 30,
                borderRadius: 'calc(var(--radius) - 2px)',
                border: 'none',
                backgroundColor: active ? 'var(--bone)' : 'transparent',
                color: active ? 'var(--ink-on-bone)' : 'var(--ink-muted)',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t.l}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'stage' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
            }}
          >
            {/* Big Artwork with Play/Pause Flash */}
            <div
              onClick={handleArtTap}
              className="ryo-pressable"
              style={{
                position: 'relative',
                width: 'min(74vw, 290px)',
                height: 'min(74vw, 290px)',
                borderRadius: 'var(--radius-card)',
                backgroundColor: 'var(--paper-lift)',
                border: '1px solid var(--line-soft)',
                overflow: 'hidden',
                boxShadow: '0 18px 46px rgba(0,0,0,0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              {currentTrack.artwork ? (
                <img
                  src={currentTrack.artwork}
                  alt={currentTrack.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <Icon name="album" size={76} color="var(--accent)" />
              )}

              {flash && (
                <div
                  className="flash-pop"
                  style={{
                    position: 'absolute',
                    width: 60,
                    height: 60,
                    borderRadius: 30,
                    backgroundColor: 'rgba(0,0,0,0.58)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={flash} size={26} color="#FFFFFF" />
                </div>
              )}
            </div>

            {/* Metadata + Offline + Like */}
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="font-display-ryo"
                  style={{
                    fontSize: 22,
                    color: 'var(--ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {currentTrack.title}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: 'var(--ink-muted)',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {currentTrack.artist}
                </div>
                <div
                  className="font-mono-tech"
                  style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 4, letterSpacing: 1.2 }}
                >
                  {currentTrack.album.toUpperCase()} · {fmtTime(duration)}
                </div>
              </div>

              <OfflineButton track={currentTrack} />

              <button
                type="button"
                onClick={() => toggleLike(currentTrack.id)}
                className="ryo-pressable"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius)',
                  backgroundColor: 'var(--paper-lift)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <Icon name="heart" size={18} color={liked ? 'var(--accent)' : 'var(--ink-muted)'} />
              </button>
            </div>
          </div>
        )}

        {tab === 'lyrics' && <LyricsView />}
        {tab === 'queue' && <QueueSheet />}
      </div>

      {/* Transport + Dynamic Seekbar + Spectrum Ribbon */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
        <SeekbarControl
          trackId={currentTrack.id}
          samples={currentTrack.waveform}
          fraction={fraction}
          duration={duration}
          accentColor="var(--accent)"
          inkColor="var(--ink-faint)"
          onSeekFraction={(f) => seek(f * duration)}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: -6 }}>
          <span className="font-mono-tech" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            {fmtTime(position)}
          </span>
          <span className="font-mono-tech" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            {fmtTime(duration)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            onClick={toggleShuffle}
            className="ryo-pressable"
            style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--radius)',
              backgroundColor: shuffle ? 'var(--accent-soft)' : 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="shuffle" size={18} color={shuffle ? 'var(--accent)' : 'var(--ink-muted)'} />
          </button>

          <button
            type="button"
            onClick={prev}
            className="ryo-pressable"
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="previous" size={20} color="var(--ink)" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="ryo-pressable"
            style={{
              width: 60,
              height: 48,
              borderRadius: 24,
              backgroundColor: 'var(--bone)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={22} color="var(--ink-on-bone)" />
          </button>

          <button
            type="button"
            onClick={next}
            className="ryo-pressable"
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="next" size={20} color="var(--ink)" />
          </button>

          <button
            type="button"
            onClick={cycleRepeat}
            className="ryo-pressable"
            style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--radius)',
              backgroundColor: repeat !== 'off' ? 'var(--accent-soft)' : 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon
              name={repeat === 'one' ? 'repeat-one' : 'repeat'}
              size={18}
              color={repeat !== 'off' ? 'var(--accent)' : 'var(--ink-muted)'}
            />
          </button>
        </div>

        {/* Bottom tools + Spectrum Ribbon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={triggerOsd}
            className="ryo-pressable"
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="volume" size={16} color="var(--ink-muted)" />
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            {visualizerStyle === 'dot-matrix' ? (
              <DotMatrixSpectrum points={spectrumPoints} isPlaying={isPlaying} cols={26} rows={5} />
            ) : (
              <SpectrumCanvas points={spectrumPoints} live={isPlaying} height={36} />
            )}
          </div>

          <button
            type="button"
            onClick={onOpenSound}
            className="ryo-pressable"
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon name="sound" size={16} color="var(--ink-muted)" />
          </button>
        </div>
      </div>
    </div>
  );
};
