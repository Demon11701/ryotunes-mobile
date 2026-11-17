import React from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';
import { DotMatrixGrid } from './DotMatrixGrid';
import { InstrumentBrackets } from './InstrumentBrackets';
import { InstrumentScale } from './InstrumentScale';

/**
 * Exact port of ~/.config/quickshell/ii/modules/ii/onScreenDisplay/OsdValueIndicator.qml:
 * Supports dual theming (Nothing OS Obsidian Purple OR active skin inheritance).
 */
export const VolumeOsd: React.FC = () => {
  const { osdVisible, dismissOsd, volume, muted, setVolume, toggleMute } = useAudio();
  const { bentoTokens, decor } = useTheme();

  if (!osdVisible) return null;

  const formattedPercent = muted
    ? 'MUTE'
    : `${volume < 10 ? '00' : volume < 100 ? '0' : ''}${volume}%`;

  const accent = muted ? bentoTokens.error : bentoTokens.accent;
  const readoutColor = muted ? bentoTokens.error : bentoTokens.accentLavender;

  return (
    <div
      onClick={dismissOsd}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        backgroundColor: 'rgba(5, 4, 8, 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 'calc(var(--safe-top) + 56px)',
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="osd-pop"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 350,
          borderRadius: Math.min(18, bentoTokens.radiusCard),
          backgroundColor: bentoTokens.bgDeep,
          border: `1px solid ${accent}`,
          boxShadow: muted ? '0 14px 36px rgba(255, 82, 99, 0.25)' : `0 14px 36px ${bentoTokens.glowSoft}`,
          overflow: 'hidden',
          padding: '14px 16px',
        }}
      >
        {decor === 'rich' && (
          <DotMatrixGrid step={10} inset={5} color={bentoTokens.accentLavender} opacity={0.16} />
        )}
        <InstrumentBrackets color={accent} length={9} weight={2} inset={6} opacity={0.95} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={toggleMute}
            title="Tap to toggle Mute"
            className="ryo-pressable"
            style={{
              width: 46,
              height: 46,
              borderRadius: 10,
              backgroundColor: bentoTokens.bgOsdBox,
              border: `1px solid ${muted ? bentoTokens.error : bentoTokens.borderDim}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon
              name={muted || volume === 0 ? 'volume-mute' : 'volume'}
              size={22 + Math.round(6 * (muted ? 0 : volume / 100))}
              color={readoutColor}
            />
          </button>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent, flexShrink: 0 }} />
              <span
                style={{
                  fontFamily: bentoTokens.fontMono,
                  flex: 1,
                  fontSize: 11.5,
                  color: bentoTokens.ink,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                AUDIO OUT // VOLUME
              </span>
              <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 16, color: readoutColor, flexShrink: 0 }}>
                {formattedPercent}
              </span>
            </div>

            <InstrumentScale
              divisions={32}
              majorEvery={4}
              fraction={muted ? 0 : volume / 100}
              ink={bentoTokens.scaleInk}
              accent={accent}
              height={14}
              interactive
              onSeekFraction={(f) => setVolume(Math.round(f * 100), true)}
            />
          </div>
        </div>

        <div style={{ position: 'relative', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            onClick={() => setVolume(volume - 10, true)}
            className="ryo-pressable"
            style={{
              flex: 1,
              height: 28,
              borderRadius: 8,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              color: bentoTokens.ink,
              fontFamily: bentoTokens.fontMono,
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            -10%
          </button>
          <button
            type="button"
            onClick={toggleMute}
            className="ryo-pressable"
            style={{
              flex: 1,
              height: 28,
              borderRadius: 8,
              backgroundColor: muted ? 'rgba(255,82,99,0.2)' : bentoTokens.bgElevated,
              border: `1px solid ${muted ? bentoTokens.error : bentoTokens.borderDim}`,
              color: muted ? bentoTokens.error : bentoTokens.accentLavender,
              fontFamily: bentoTokens.fontMono,
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            {muted ? 'UNMUTE' : 'MUTE'}
          </button>
          <button
            type="button"
            onClick={() => setVolume(volume + 10, true)}
            className="ryo-pressable"
            style={{
              flex: 1,
              height: 28,
              borderRadius: 8,
              backgroundColor: bentoTokens.bgElevated,
              border: `1px solid ${bentoTokens.borderDim}`,
              color: bentoTokens.ink,
              fontFamily: bentoTokens.fontMono,
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            +10%
          </button>
        </div>
      </div>
    </div>
  );
};
