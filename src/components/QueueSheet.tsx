import React, { useMemo, useState } from 'react';
import { fmtTime, useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { Artwork } from './Artwork';

/**
 * Port of /usr/share/ryotunes/client/chrome/QueuePanel.qml
 */
export const QueueSheet: React.FC = () => {
  const {
    queue,
    queueIndex,
    currentTrack,
    stopAfterCurrent,
    playQueueIndex,
    removeFromQueue,
    moveQueueItem,
    toggleStopAfterCurrent,
    clearUpcomingQueue,
  } = useAudio();

  const [query, setQuery] = useState('');

  const upcoming = useMemo(() => {
    return queue
      .map((item, idx) => ({ item, idx }))
      .filter(({ idx, item }) => {
        if (idx <= queueIndex) return false;
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return (
          item.title.toLowerCase().includes(q) ||
          item.artist.toLowerCase().includes(q) ||
          item.album.toLowerCase().includes(q)
        );
      });
  }, [queue, queueIndex, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      {/* Search queue input */}
      <div
        style={{
          height: 36,
          borderRadius: 'var(--radius)',
          backgroundColor: 'var(--tint-5)',
          border: '1px solid var(--line-soft)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
        }}
      >
        <Icon name="search" size={14} color="var(--ink-muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search queue"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--ink)',
            fontSize: 13.5,
          }}
        />
      </div>

      {/* Now Playing Highlighted Card */}
      {currentTrack && (
        <div>
          <div
            className="font-mono-tech"
            style={{ fontSize: 10, color: 'var(--ink-muted)', letterSpacing: 1.4, marginBottom: 6 }}
          >
            NOW PLAYING
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line-soft)',
            }}
          >
            <Artwork src={currentTrack.artwork} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--accent)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {currentTrack.title}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ink-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {currentTrack.artist}
              </div>
            </div>
            <span className="font-mono-tech" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
              {fmtTime(currentTrack.duration)}
            </span>
          </div>
        </div>
      )}

      {/* Up Next List */}
      <div
        className="font-mono-tech"
        style={{ fontSize: 10, color: 'var(--ink-muted)', letterSpacing: 1.4, marginTop: 4 }}
      >
        UP NEXT ({upcoming.length})
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {upcoming.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
            Nothing up next.
          </div>
        ) : (
          upcoming.map(({ item, idx }) => (
            <div
              key={`${item.id}-${idx}`}
              onClick={() => playQueueIndex(idx)}
              className="ryo-pressable"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 8px',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
            >
              <Artwork src={item.artwork} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: 'var(--ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.artist}
                </div>
              </div>
              <button
                type="button"
                aria-label="Move up"
                onClick={(e) => {
                  e.stopPropagation();
                  if (idx > queueIndex + 1) moveQueueItem(idx, idx - 1);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 4,
                  cursor: 'pointer',
                  opacity: idx > queueIndex + 1 ? 0.8 : 0.25,
                }}
              >
                <Icon name="arrow-up" size={14} color="var(--ink-muted)" />
              </button>
              <button
                type="button"
                aria-label="Remove from queue"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromQueue(idx);
                }}
                style={{ background: 'transparent', border: 'none', padding: 4, cursor: 'pointer' }}
              >
                <Icon name="close" size={14} color="var(--ink-muted)" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer: Stop after current + Clear */}
      <div
        style={{
          borderTop: '1px solid var(--line-soft)',
          paddingTop: 10,
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={toggleStopAfterCurrent}
          className="ryo-pressable"
          style={{
            flex: 1,
            height: 36,
            borderRadius: 'var(--radius)',
            backgroundColor: stopAfterCurrent ? 'var(--accent-soft)' : 'transparent',
            border: `1px solid ${stopAfterCurrent ? 'var(--accent)' : 'var(--line)'}`,
            color: stopAfterCurrent ? 'var(--accent)' : 'var(--ink)',
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            cursor: 'pointer',
          }}
        >
          {stopAfterCurrent && <Icon name="check-circle" size={14} color="var(--accent)" />}
          <span>{stopAfterCurrent ? 'Stopping after this' : 'Stop after current'}</span>
        </button>

        {upcoming.length > 0 && (
          <button
            type="button"
            onClick={clearUpcomingQueue}
            className="ryo-pressable"
            style={{
              height: 36,
              padding: '0 14px',
              borderRadius: 'var(--radius)',
              backgroundColor: 'transparent',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
};
