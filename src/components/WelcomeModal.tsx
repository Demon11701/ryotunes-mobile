import React, { useState } from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { AccountProviderId } from '../audio/types';
import { Icon } from '../icons/Icon';
import { PROVIDER_COLORS } from '../theme/skins';
import { useTheme } from '../theme/ThemeContext';

interface WelcomeModalProps {
  open: boolean;
  onFinish: (openAccounts?: boolean) => void;
}

const PROVIDERS: Array<{
  id: AccountProviderId;
  name: string;
  icon: string;
  color: string;
}> = [
  { id: 'ytmusic', name: 'YouTube Music', icon: 'youtube-music', color: PROVIDER_COLORS.youtube },
  { id: 'spotify', name: 'Spotify', icon: 'spotify', color: PROVIDER_COLORS.spotify },
  { id: 'soundcloud', name: 'SoundCloud', icon: 'soundcloud', color: PROVIDER_COLORS.soundcloud },
  { id: 'tidal', name: 'TIDAL', icon: 'tidal', color: PROVIDER_COLORS.tidal },
];

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ open, onFinish }) => {
  const { bentoTokens } = useTheme();
  const { isNativeAndroid, syncDeviceLibrary, accounts, connectAccount } = useAudio();
  const [step, setStep] = useState<1 | 2>(1);
  const [granting, setGranting] = useState(false);

  if (!open) return null;

  const completeOnboarding = (openAccounts = false) => {
    try {
      localStorage.setItem('ryotunes_onboarded', 'true');
    } catch {
      // ignore storage errors
    }
    onFinish(openAccounts);
  };

  const handleGrantPermissions = async () => {
    setGranting(true);
    try {
      if (isNativeAndroid) {
        await syncDeviceLibrary(true);
      }
    } finally {
      setGranting(false);
      setStep(2);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 130,
        backgroundColor: 'rgba(6, 4, 12, 0.82)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%',
          maxWidth: 400,
          borderRadius: 24,
          backgroundColor: bentoTokens.bgElevated,
          border: `1px solid ${bentoTokens.borderDim}`,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            className="font-ndot"
            style={{
              fontSize: 12,
              letterSpacing: 1.4,
              color: bentoTokens.accentLavender,
            }}
          >
            ● RYOTUNES // SETUP 0{step}/02
          </span>
          <button
            type="button"
            onClick={() => completeOnboarding(false)}
            className="font-mono-tech"
            style={{
              background: 'transparent',
              border: 'none',
              color: bentoTokens.muted,
              fontSize: 10.5,
              cursor: 'pointer',
              padding: '4px 6px',
            }}
          >
            OMITIR
          </button>
        </div>

        {/* Step Indicator */}
        <div style={{ display: 'flex', gap: 6 }}>
          <div
            style={{
              flex: 1,
              height: 4,
              borderRadius: 999,
              backgroundColor: bentoTokens.accent,
            }}
          />
          <div
            style={{
              flex: 1,
              height: 4,
              borderRadius: 999,
              backgroundColor: step === 2 ? bentoTokens.accent : bentoTokens.bgSurface,
            }}
          />
        </div>

        {step === 1 ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 className="font-display-ryo" style={{ margin: 0, fontSize: 25, color: bentoTokens.ink }}>
                Bienvenido a Ryotunes
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: bentoTokens.muted, lineHeight: 1.5 }}>
                Reproductor Hi-Fi con streaming multi-plataforma, descargas offline y espectro en vivo.
                Concede acceso a tu música local y notificaciones multimedia para controlar el audio desde la pantalla bloqueada.
              </p>
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 16,
                backgroundColor: bentoTokens.bgSurface,
                border: `1px solid ${bentoTokens.borderDim}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="folder" size={18} color={bentoTokens.accentLavender} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: bentoTokens.ink }}>
                    Biblioteca Local (MediaStore)
                  </div>
                  <div style={{ fontSize: 11.5, color: bentoTokens.muted }}>
                    Detecta automáticamente tus archivos MP3, FLAC, M4A y WAV.
                  </div>
                </div>
              </div>
              <div style={{ height: 1, backgroundColor: bentoTokens.borderDim }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="sound" size={18} color={bentoTokens.accentLavender} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: bentoTokens.ink }}>
                    Controles en Pantalla Bloqueada
                  </div>
                  <div style={{ fontSize: 11.5, color: bentoTokens.muted }}>
                    Mantiene el audio Hi-Fi en segundo plano sin cortes.
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="font-mono-tech ryo-pressable"
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 999,
                  backgroundColor: bentoTokens.bgSurface,
                  border: `1px solid ${bentoTokens.borderDim}`,
                  color: bentoTokens.muted,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                DESPUÉS
              </button>
              <button
                type="button"
                disabled={granting}
                onClick={handleGrantPermissions}
                className="font-mono-tech ryo-pressable"
                style={{
                  flex: 1.6,
                  height: 42,
                  borderRadius: 999,
                  backgroundColor: bentoTokens.accent,
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: granting ? 'wait' : 'pointer',
                }}
              >
                {granting ? 'SOLICITANDO…' : 'CONCEDER PERMISOS'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 className="font-display-ryo" style={{ margin: 0, fontSize: 24, color: bentoTokens.ink }}>
                Sincroniza tus Playlists
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: bentoTokens.muted, lineHeight: 1.45 }}>
                Inicia sesión en cualquiera de tus cuentas para importar tus playlists y favoritos, o continúa directo al reproductor.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {PROVIDERS.map((p) => {
                const status = accounts[p.id];
                const connected = Boolean(status?.connected);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      void connectAccount(p.id);
                    }}
                    className="ryo-pressable"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 14,
                      backgroundColor: bentoTokens.bgSurface,
                      border: `1px solid ${connected ? p.color : bentoTokens.borderDim}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name={p.icon} size={18} color={p.color} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: bentoTokens.ink,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {p.name}
                      </div>
                      <div
                        className="font-mono-tech"
                        style={{
                          fontSize: 9.5,
                          color: connected ? '#4ADE80' : bentoTokens.muted,
                        }}
                      >
                        {connected ? '● CONECTADO' : 'CONECTAR'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => completeOnboarding(true)}
                className="font-mono-tech ryo-pressable"
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 999,
                  backgroundColor: bentoTokens.bgSurface,
                  border: `1px solid ${bentoTokens.borderDim}`,
                  color: bentoTokens.ink,
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                VER CUENTAS
              </button>
              <button
                type="button"
                onClick={() => completeOnboarding(false)}
                className="font-mono-tech ryo-pressable"
                style={{
                  flex: 1.4,
                  height: 42,
                  borderRadius: 999,
                  backgroundColor: bentoTokens.accent,
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                EMPEZAR A ESCUCHAR
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
