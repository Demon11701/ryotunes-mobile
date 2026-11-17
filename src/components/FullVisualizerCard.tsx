import React from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { sampleBandInterpolated } from '../audio/spectrumUtils';
import { VisualizerStyle } from '../audio/types';
import { useTheme } from '../theme/ThemeContext';
import { DotMatrixGrid } from './DotMatrixGrid';
import { InstrumentBrackets } from './InstrumentBrackets';
import { SpectrumCanvas } from './SpectrumCanvas';
import { WaveVisualizerCanvas } from './WaveVisualizerCanvas';

interface FullVisualizerCardProps {
  tall?: boolean;
  embedded?: boolean;
}

/**
 * Port of ~/.config/quickshell/ii/modules/ii/background/widgets/visualizer/VisualizerWidget.qml:
 * Supports Dot-Matrix 38x10, Spectrum Wave, and Spectrum Bars with fractional gapless FFT mapping.
 */
export const FullVisualizerCard: React.FC<FullVisualizerCardProps> = ({
  tall = false,
  embedded = false,
}) => {
  const { spectrumPoints, isPlaying } = useAudio();
  const { bentoTokens, bentoThemeMode, visualizerStyle, setVisualizerStyle, decor } = useTheme();

  const barCount = 38;
  const dotRows = 10;

  const cycleMode = () => {
    const order: VisualizerStyle[] = ['dot-matrix', 'spectrum-wave', 'spectrum-bars'];
    const idx = order.indexOf(visualizerStyle);
    setVisualizerStyle(order[(idx + 1) % order.length]);
  };

  const vizHeight = embedded ? 148 : tall ? 154 : 70;

  return (
    <section
      style={{
        position: 'relative',
        width: '100%',
        height: embedded ? 204 : tall ? 210 : 126,
        borderRadius: embedded ? Math.min(12, bentoTokens.radiusCard) : bentoTokens.radiusCard,
        backgroundColor: bentoThemeMode === 'nothing' ? 'rgba(10, 10, 12, 0.92)' : bentoTokens.bgSurface,
        border: `1px solid ${isPlaying ? bentoTokens.accent : bentoTokens.borderDim}`,
        overflow: 'hidden',
        padding: embedded ? 10 : 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {!embedded && decor === 'rich' && (
        <DotMatrixGrid step={12} color={bentoTokens.ink} opacity={0.12} inset={0} dotSize={1.5} />
      )}
      {!embedded && (
        <InstrumentBrackets color={bentoTokens.accent} length={8} weight={1} inset={8} opacity={0.45} />
      )}

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
        <span style={{ fontFamily: bentoTokens.fontMono, fontSize: 10.5, color: bentoTokens.ink, letterSpacing: '0.06em' }}>
          {isPlaying ? 'GLYPH MATRIX // 38CH LIVE FFT' : 'GLYPH MATRIX // STANDBY'}
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
            live={isPlaying}
            color={bentoTokens.glowMedium}
            blurPx={1}
          />
        ) : visualizerStyle === 'spectrum-bars' ? (
          <SpectrumCanvas
            points={spectrumPoints}
            live={isPlaying}
            height={vizHeight}
            forceMode="bars"
            accentOverride={bentoTokens.accent}
            inkOverride={bentoTokens.ink}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'stretch', gap: 2.5 }}>
            {Array.from({ length: barCount }).map((_, colIdx) => {
              const rawVal =
                isPlaying && spectrumPoints.length > 0
                  ? sampleBandInterpolated(spectrumPoints, colIdx, barCount, 1000)
                  : 0;
              const litDots = rawVal > 0.01 ? Math.max(1, Math.round(Math.pow(rawVal, 0.78) * dotRows)) : 0;

              return (
                <div key={colIdx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {Array.from({ length: dotRows }).map((__, rowIdx) => {
                    const rowFromBottom = dotRows - 1 - rowIdx;
                    const isLit = rowFromBottom < litDots;
                    const isPeak = rowFromBottom === litDots - 1 && litDots > 0;
                    const dotColor = isPeak
                      ? bentoTokens.accentLavender
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
