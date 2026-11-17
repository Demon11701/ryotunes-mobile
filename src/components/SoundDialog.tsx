import React from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { AudioFxState } from '../audio/types';
import { Icon } from '../icons/Icon';

interface SoundDialogProps {
  open: boolean;
  onClose: () => void;
}

const PRESETS: { name: string; fx: AudioFxState }[] = [
  { name: 'Flat', fx: { speed: 1, semitones: 0, reverb: 0, bass: 0, width: 0 } },
  { name: 'Slowed + Reverb', fx: { speed: 0.85, semitones: 0, reverb: 0.6, bass: 0, width: 0 } },
  { name: 'Nightcore', fx: { speed: 1.25, semitones: 2, reverb: 0, bass: 0, width: 0 } },
  { name: 'Bass Boost', fx: { speed: 1, semitones: 0, reverb: 0, bass: 8, width: 0 } },
  { name: 'Wide', fx: { speed: 1, semitones: 0, reverb: 0, bass: 0, width: 0.8 } },
];

/**
 * Port of /usr/share/ryotunes/client/chrome/SoundDialog.qml:
 * Snapshot-blur modal with 5 presets + 5 real-time WebAudio FX sliders.
 */
export const SoundDialog: React.FC<SoundDialogProps> = ({ open, onClose }) => {
  const { audioFx, setAudioFx } = useAudio();
  if (!open) return null;

  const isPresetActive = (p: AudioFxState) =>
    audioFx.speed === p.speed &&
    audioFx.semitones === p.semitones &&
    audioFx.reverb === p.reverb &&
    audioFx.bass === p.bass &&
    audioFx.width === p.width;

  const sliders: {
    key: keyof AudioFxState;
    label: string;
    min: number;
    max: number;
    step: number;
    fmt: (v: number) => string;
  }[] = [
    { key: 'speed', label: 'Tempo', min: 0.25, max: 2.0, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'semitones', label: 'Pitch', min: -12, max: 12, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v} st` },
    { key: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'bass', label: 'Bass Boost', min: -6, max: 12, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v} dB` },
    { key: 'width', label: 'Stereo Width', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 85,
        backgroundColor: 'rgba(5, 4, 8, 0.65)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="osd-pop"
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 'var(--radius-card)',
          backgroundColor: 'var(--paper)',
          border: '1px solid var(--line)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="font-mono-tech" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: 1.4 }}>
              AUDIO // DSP EFFECTS
            </div>
            <div className="font-display-ryo" style={{ fontSize: 22, color: 'var(--ink)', marginTop: 2 }}>
              Sound Studio
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ryo-pressable"
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius)',
              backgroundColor: 'var(--paper-lift)',
              border: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="close" size={16} color="var(--ink)" />
          </button>
        </div>

        {/* Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map((p) => {
            const active = isPresetActive(p.fx);
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => setAudioFx(p.fx)}
                className="ryo-pressable"
                style={{
                  height: 30,
                  padding: '0 12px',
                  borderRadius: 999,
                  border: `1px solid ${active ? 'var(--bone)' : 'var(--line)'}`,
                  backgroundColor: active ? 'var(--bone)' : 'transparent',
                  color: active ? 'var(--ink-on-bone)' : 'var(--ink-muted)',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        {/* 5 Sliders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sliders.map((s) => (
            <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{s.label}</span>
                <span className="font-mono-tech" style={{ fontSize: 12, color: 'var(--accent)' }}>
                  {s.fmt(audioFx[s.key])}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={audioFx[s.key]}
                onChange={(e) => setAudioFx({ ...audioFx, [s.key]: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
