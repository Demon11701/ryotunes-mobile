import React from 'react';
import { fmtTime, useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';
import { DotMatrixGrid } from './DotMatrixGrid';
import { InstrumentBrackets } from './InstrumentBrackets';
import { InstrumentScale } from './InstrumentScale';

interface DesktopWidgetCardProps {
  onOpenLibrary: () => void;
}

/**
 * Preview port of ~/.config/quickshell/ii/modules/ii/background/widgets/mediaControls/MediaControlsWidget.qml:
 * Blueprint for the native Android Home Screen Widget, respecting dual Bento theming.
 */
export const DesktopWidgetCard: React.FC<DesktopWidgetCardProps> = ({ onOpenLibrary }) => {
  const { currentTrack, isPlaying, position, duration, togglePlay, next, prev, seek } = useAudio();
  const { bentoTokens, bentoThemeMode, decor } = useTheme();
  const fraction = duration > 0 ? position / duration : 0;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: bentoTokens.radiusCard,
        backgroundColor: bentoThemeMode === 'nothing' ? 'rgba(10, 10, 12, 0.92)' : bentoTokens.bgDeep,
        border: `1px solid ${isPlaying ? bentoTokens.accent : bentoTokens.borderDim}`,
        padding: 15,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      {decor === 'rich' && (
        <DotMatrixGrid step={12} color={bentoTokens.ink} opacity={0.14} inset={0} dotSize={1.5} />
      )}
      <InstrumentBrackets color={bentoTokens.accent} length={8} weight={1} inset={8} opacity={0.45} />

      <div style={{ position: 'relative', width: 92, height: 92, flexShrink: 0 }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: Math.min(14, bentoTokens.radiusCard),
            backgroundColor: bentoTokens.bgSurface,
            border: `1px solid ${bentoTokens.borderDim}`,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {currentTrack?.artwork ? (
            <img src={currentTrack.artwork} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <Icon name="album" size={32} color={bentoTokens.accent} />
          )}
        </div>
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: isPlaying ? bentoTokens.accent : bentoTokens.ledIdle,
            border: `1.5px solid ${bentoTokens.bgDeep}`,
          }}
        />
        <InstrumentBrackets color={isPlaying ? bentoTokens.accent : bentoTokens.ledIdle} length={10} weight={2} inset={-3} opacity={1} />
      </div>

      <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className={isPlaying ? 'led-pulsing' : ''}
            style={{
              width: 7,
              height: 7,
              borderRadius: 3.5,
              backgroundColor: isPlaying ? bentoTokens.accent : 'transparent',
              border: isPlaying ? 'none' : `1px solid ${bentoTokens.muted}`,
            }}
          />
          <span
            style={{
              fontFamily: bentoTokens.fontMono,
              flex: 1,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.09em',
              color: isPlaying ? bentoTokens.accent : bentoTokens.muted,
            }}
          >
            {isPlaying ? 'REC · CTHz' : 'STANDBY · CTHz'}
          </span>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="ryo-pressable"
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="library" size={12} color={bentoTokens.ink} />
          </button>
        </div>

        <div
          style={{
            fontFamily: bentoTokens.fontDisplay,
            fontSize: 16,
            color: bentoTokens.ink,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {(currentTrack?.title || 'NOTHING // AUDIO').toUpperCase()}
        </div>

        <div
          style={{
            fontFamily: bentoTokens.fontMono,
            fontSize: 9.5,
            letterSpacing: '0.08em',
            color: bentoTokens.muted,
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {currentTrack?.artist || 'OPEN CTHz OR START PLAYBACK'}
        </div>

        <InstrumentScale
          divisions={42}
          majorEvery={6}
          fraction={fraction}
          ink={bentoTokens.ink}
          accent={bentoTokens.accent}
          height={9}
          interactive={duration > 0}
          onSeekFraction={(f) => seek(f * duration)}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontFamily: bentoTokens.fontMono, fontSize: 7.5, color: bentoTokens.muted, letterSpacing: '0.09em' }}>
              ELAPSED
            </div>
            <div style={{ fontFamily: bentoTokens.fontMono, fontSize: 12.5, color: bentoTokens.ink }}>
              {fmtTime(position)}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: bentoTokens.fontMono, fontSize: 7.5, color: bentoTokens.muted, letterSpacing: '0.09em' }}>
              TOTAL
            </div>
            <div style={{ fontFamily: bentoTokens.fontMono, fontSize: 12.5, color: bentoTokens.ink }}>
              {duration > 0 ? fmtTime(duration) : '--:--'}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={prev}
            className="ryo-pressable"
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="previous" size={14} color={bentoTokens.ink} />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="ryo-pressable"
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: bentoTokens.accent,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={16} color="#FFFFFF" />
          </button>
          <button
            type="button"
            onClick={next}
            className="ryo-pressable"
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="next" size={14} color={bentoTokens.ink} />
          </button>
        </div>
      </div>
    </div>
  );
};
