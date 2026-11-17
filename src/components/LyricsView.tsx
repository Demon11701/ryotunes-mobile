import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';

export const LyricsView: React.FC = () => {
  const { currentTrack, position, seek, lyricsLoading } = useAudio();
  const [offsetMs, setOffsetMs] = useState(0);
  const [manualScroll, setManualScroll] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const timerRef = useRef<number | null>(null);

  const lyrics = currentTrack?.lyrics;
  const synced = Boolean(lyrics?.synced);

  useEffect(() => {
    setOffsetMs(0);
    setManualScroll(false);
  }, [currentTrack?.id]);

  const posMs = position * 1000 - offsetMs;

  const activeIndex = useMemo(() => {
    if (!synced || !lyrics?.lines?.length) return -1;
    let ans = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const t = lyrics.lines[i].timeMs;
      if (t !== undefined && t <= posMs) ans = i;
    }
    return ans;
  }, [synced, lyrics, posMs]);

  useEffect(() => {
    if (manualScroll || activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIndex, manualScroll]);

  const handleManualScroll = () => {
    setManualScroll(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setManualScroll(false), 5000);
  };

  if (!lyrics || !lyrics.lines?.length) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <Icon name="mic" size={28} color="var(--ink-faint)" />
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
          {lyricsLoading ? 'Searching LRCLIB synced lyrics...' : 'No lyrics found for this track.'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
          {currentTrack ? `${currentTrack.title} · ${currentTrack.artist}` : 'Select a track'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {manualScroll && synced && activeIndex >= 0 && (
        <button
          type="button"
          onClick={() => setManualScroll(false)}
          className="font-mono-tech ryo-pressable"
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5,
            padding: '5px 12px',
            borderRadius: 999,
            backgroundColor: 'var(--paper-lift)',
            border: '1px solid var(--line-strong)',
            color: 'var(--ink-dim)',
            fontSize: 11,
            letterSpacing: 1.2,
            cursor: 'pointer',
          }}
        >
          CURRENT LINE
        </button>
      )}

      <div
        ref={listRef}
        onWheel={handleManualScroll}
        onTouchMove={handleManualScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '36px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {lyrics.lines.map((line, i) => {
          const isActive = synced && i === activeIndex;
          const isPast = synced && i < activeIndex;
          const color = !synced || isActive ? 'var(--ink)' : isPast ? 'var(--ink-faint)' : 'var(--ink-muted)';
          return (
            <button
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              type="button"
              onClick={() => {
                if (synced && line.timeMs !== undefined) {
                  seek(Math.max(0, (line.timeMs + offsetMs) / 1000));
                  setManualScroll(false);
                }
              }}
              style={{
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                padding: '4px 8px',
                cursor: synced ? 'pointer' : 'default',
                opacity: !synced ? 0.85 : isActive ? 1 : 0.65,
                transform: isActive ? 'scale(1.01)' : 'scale(1)',
                transition: 'opacity 180ms ease, transform 180ms ease, color 180ms ease',
              }}
            >
              <div
                className="font-display-ryo"
                style={{
                  fontSize: isActive ? 21 : 17,
                  lineHeight: 1.28,
                  color: isActive ? 'var(--accent)' : color,
                }}
              >
                {line.text || '♪'}
              </div>
              {line.romanized && (
                <div
                  className="font-mono-tech"
                  style={{
                    fontSize: 11,
                    color,
                    opacity: 0.72,
                    marginTop: 4,
                    letterSpacing: '0.06em',
                  }}
                >
                  {line.romanized}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Timing Footer */}
      <div
        style={{
          borderTop: '1px solid var(--line-soft)',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.2 }}>
          {(lyrics.source || 'LYRICS').toUpperCase()}
        </span>
        {synced && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', marginRight: 4 }}>
              {offsetMs > 0 ? '+' : ''}
              {(offsetMs / 1000).toFixed(1)}s
            </span>
            {[
              { label: '-0.5', delta: -500 },
              { label: 'Reset', delta: 0 },
              { label: '+0.5', delta: 500 },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                onClick={() => setOffsetMs((prev) => (b.delta === 0 ? 0 : Math.max(-5000, Math.min(5000, prev + b.delta))))}
                style={{
                  background: 'var(--tint-5)',
                  border: '1px solid var(--line-soft)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--ink-dim)',
                  fontSize: 11,
                  padding: '3px 7px',
                  cursor: 'pointer',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
