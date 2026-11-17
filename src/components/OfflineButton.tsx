import React from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { Track } from '../audio/types';
import { Icon } from '../icons/Icon';

interface OfflineButtonProps {
  track: Track;
  compact?: boolean;
}

/**
 * Interactive [ ↓ OFFLINE ] button matching DownloadButton.qml:
 * saves online audio + cover art to local device/IndexedDB for offline playback.
 */
export const OfflineButton: React.FC<OfflineButtonProps> = ({ track, compact = false }) => {
  const { offlineTracks, downloadProgress, downloadTrack, removeOffline } = useAudio();
  if (track.source === 'local') return null;

  const isSaved = track.offline || offlineTracks.some((o) => o.id === track.id);
  const progress = downloadProgress[track.id];
  const isDownloading = progress !== undefined && progress > 0 && progress < 100;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloading) return;
    if (isSaved) {
      removeOffline(track.id);
    } else {
      downloadTrack(track);
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={isSaved ? 'Saved offline (tap to remove)' : 'Download for offline playback'}
        aria-label={isSaved ? 'Saved offline' : 'Download offline'}
        className="ryo-pressable"
        style={{
          width: 30,
          height: 30,
          borderRadius: 'var(--radius)',
          backgroundColor: isSaved ? 'var(--accent-soft)' : 'transparent',
          border: isSaved ? '1px solid var(--accent)' : '1px solid transparent',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {isDownloading ? (
          <span className="font-mono-tech" style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700 }}>
            {progress}%
          </span>
        ) : (
          <Icon name={isSaved ? 'check-circle' : 'download'} size={15} color={isSaved ? 'var(--accent)' : 'var(--ink-muted)'} />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="ryo-pressable font-mono-tech"
      style={{
        height: 24,
        padding: '0 8px',
        borderRadius: 6,
        backgroundColor: isSaved ? 'var(--accent-soft)' : 'var(--paper-lift)',
        border: `1px solid ${isSaved || isDownloading ? 'var(--accent)' : 'var(--line)'}`,
        color: isSaved || isDownloading ? 'var(--accent)' : 'var(--ink)',
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: 0.6,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <Icon
        name={isSaved ? 'check-circle' : 'download'}
        size={11}
        color={isSaved || isDownloading ? 'var(--accent)' : 'var(--ink)'}
      />
      <span>{isDownloading ? `${progress}%` : 'OFFLINE'}</span>
    </button>
  );
};
