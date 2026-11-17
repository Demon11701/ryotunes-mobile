import React from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { VisualizerStyle } from '../audio/types';
import { useTheme } from '../theme/ThemeContext';
import { DotMatrixGrid } from './DotMatrixGrid';
import { InstrumentBrackets } from './InstrumentBrackets';
import { SpectrumCanvas } from './SpectrumCanvas';
import { WaveVisualizerCanvas } from './WaveVisualizerCanvas';

interface FullVisualizerCardProps {
  tall?: boolean;
}

/**
 * Port of ~/.config/quickshell/ii/modules/ii/background/widgets/visualizer/VisualizerWidget.qml:
 * Supports Dot-Matrix 38x10, Spectrum Wave, and Spectrum Bars, and honors Bento dual theming.
 */
export const FullVisualizerCard: React.FC<FullVisualizerCardProps> = ({ tall = false }) => {
  const { spectrumPoints, isPlaying } = useAudio();
  const { bentoTokens, bentoThemeMode, visualizerStyle, setVisualizerStyle, decor } = useTheme();

  const barCount = 38;
  const dotRows = 10;

  const cycleMode = () => {
    const order: VisualizerStyle[] = ['dot-matrix', 'spectrum-wave', 'spectrum-bars'];
    const idx = order.indexOf(visualizerStyle);
    setVisualizerStyle(order[(idx + 1) % order.length]);
  };

  return (
    <section
      style={{
        position: 'relative',
        width: '100%',
        height: tall ? 210 : 126,
        borderRadius: bentoTokens.radiusCard,
        backgroundColor: bentoThemeMode === 'nothing' ? 'rgba(10, 10, 12, 0.92)' : bentoTokens.bgSurface,
        border: `1px solid ${isPlaying ? bentoTokens.accent : bentoTokens.borderDim}`,
        overflow: 'hidden',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {decor === 'rich' && (
        <DotMatrixGrid step={12} color={bentoTokens.ink} opacity={0.12} inset={0} dotSize={1.5} />
      )}
      <InstrumentBrackets color={bentoTokens.accent} length={8} weight={1} inset={8} opacity={0.45} />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          className={isPlaying ? 'led-pulsing' : ''}
          style={{
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: isPlaying ? bentoTokens.accent : bentoTokens.ledIdle,
          }}
        />
        <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 11, color: bentoTokens.ink, letterSpacing: '0.06em' }}>
          {isPlaying ? 'GLYPH MATRIX // LIVE SPECTRUM' : 'GLYPH MATRIX // STANDBY'}
        </span>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={cycleMode}
          className="ryo-pressable"
          style={{
            fontFamily: bentoTokens.fontMono,
            background: bentoTokens.glowSoft,
            border: `1px solid ${bentoTokens.accent}`,
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 9,
            fontWeight: 600,
            color: bentoTokens.accentLavender,
            letterSpacing: '0.08em',
            cursor: 'pointer',
          }}
        >
          {visualizerStyle === 'spectrum-wave'
            ? 'WAVE · 40CH'
            : visualizerStyle === 'spectrum-bars'
            ? 'BARS · 40CH'
            : `NDOT · ${barCount}CH`}
        </button>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {visualizerStyle === 'spectrum-wave' ? (
          <WaveVisualizerCanvas
            points={spectrumPoints}
            live={true}
            color={bentoTokens.glowMedium}
            blurPx={1}
          />
        ) : visualizerStyle === 'spectrum-bars' ? (
          <SpectrumCanvas
            points={spectrumPoints}
            live={isPlaying}
            height={tall ? 154 : 70}
            forceMode="bars"
            accentOverride={bentoTokens.accent}
            inkOverride={bentoTokens.ink}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'stretch', gap: 3 }}>
            {Array.from({ length: barCount }).map((_, colIdx) => {
              const pts = spectrumPoints;
              const mappedIdx = pts.length > 0 ? Math.min(pts.length - 1, Math.floor((colIdx * pts.length) / barCount)) : 0;
              const rawVal = pts.length > 0 ? Math.max(0, Math.min(1, (pts[mappedIdx] || 0) / 1000)) : 0;
              const litDots = Math.round(Math.pow(rawVal, 0.8) * dotRows);

              return (
                <div key={colIdx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {Array.from({ length: dotRows }).map((__, rowIdx) => {
                    const rowFromBottom = dotRows - 1 - rowIdx;
                    const isLit = rowFromBottom < litDots;
                    const isPeak = rowFromBottom === litDots && litDots > 0;
                    const dotColor = isPeak
                      ? bentoTokens.accent
                      : isLit
                      ? rowFromBottom >= dotRows - 2
                        ? bentoTokens.accent
                        : bentoTokens.vizDotBody
                      : bentoTokens.vizDotUnlit;

                    return (
                      <div
                        key={rowIdx}
                        style={{
                          flex: 1,
                          borderRadius: 999,
                          backgroundColor: dotColor,
                          opacity: isPeak || isLit ? 0.96 : 0.45,
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
