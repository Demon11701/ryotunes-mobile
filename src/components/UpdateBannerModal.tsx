import React, { useEffect, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { isAndroidNative, RyotunesNativeMedia } from '../audio/NativeMediaBridge';
import { GithubUpdateInfo } from '../audio/types';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';

interface UpdateBannerModalProps {
  open: boolean;
  updateInfo: GithubUpdateInfo | null;
  onClose: () => void;
}

function formatMb(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UpdateBannerModal: React.FC<UpdateBannerModalProps> = ({ open, updateInfo, onClose }) => {
  const { bentoTokens } = useTheme();
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);

  useEffect(() => {
    if (!open || !isAndroidNative()) return;
    let handle: PluginListenerHandle | null = null;
    RyotunesNativeMedia.addListener('updateProgress', (ev) => {
      if (typeof ev.progress === 'number') {
        setProgress(Math.max(0, Math.min(100, Math.round(ev.progress))));
      }
    })
      .then((h) => {
        handle = h;
      })
      .catch(() => {});
    return () => {
      handle?.remove().catch(() => {});
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDownloading(false);
      setProgress(0);
      setErrorMsg(null);
      setNeedsPermission(false);
    }
  }, [open]);

  if (!open || !updateInfo || !updateInfo.hasUpdate) return null;

  const handleInstall = async () => {
    if (downloading) return;
    if (!isAndroidNative()) {
      window.open(updateInfo.apkUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setErrorMsg(null);
    setNeedsPermission(false);
    setDownloading(true);
    setProgress(2);
    try {
      const res = await RyotunesNativeMedia.downloadAndInstallUpdate({
        apkUrl: updateInfo.apkUrl,
        version: updateInfo.latestVersion,
      });
      if (res?.needsPermission) {
        setDownloading(false);
        setProgress(0);
        setNeedsPermission(true);
        return;
      }
      setProgress(100);
      setDownloading(false);
    } catch (err) {
      setDownloading(false);
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo descargar la actualización');
    }
  };

  const sizeLabel = formatMb(updateInfo.apkSizeBytes);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 140,
        backgroundColor: 'rgba(6, 4, 12, 0.78)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
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
          borderRadius: 22,
          backgroundColor: bentoTokens.bgElevated,
          border: `1px solid ${bentoTokens.accent}`,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: bentoTokens.accent,
                boxShadow: `0 0 10px ${bentoTokens.accent}`,
              }}
            />
            <span
              className="font-ndot"
              style={{
                fontSize: 12.5,
                letterSpacing: 1.2,
                color: bentoTokens.ink,
              }}
            >
              UPDATE AVAILABLE // v{updateInfo.latestVersion}
            </span>
          </div>
          {!downloading && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar aviso"
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                backgroundColor: bentoTokens.bgSurface,
                border: `1px solid ${bentoTokens.borderDim}`,
                color: bentoTokens.muted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="close" size={14} color={bentoTokens.muted} />
            </button>
          )}
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 14,
            backgroundColor: bentoTokens.bgSurface,
            border: `1px solid ${bentoTokens.borderDim}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="font-mono-tech" style={{ fontSize: 10, color: bentoTokens.muted }}>
              VERSIÓN INSTALADA → NUEVA
            </span>
            <span className="font-mono-tech" style={{ fontSize: 12.5, fontWeight: 700, color: bentoTokens.ink }}>
              v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
            </span>
          </div>
          {sizeLabel && (
            <span
              className="font-mono-tech"
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                backgroundColor: 'rgba(168, 85, 247, 0.16)',
                border: `1px solid ${bentoTokens.accent}66`,
                color: bentoTokens.accentLavender,
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {sizeLabel}
            </span>
          )}
        </div>

        {updateInfo.releaseNotes.trim().length > 0 && (
          <div
            style={{
              maxHeight: 165,
              overflowY: 'auto',
              padding: 12,
              borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.03)',
              border: `1px solid ${bentoTokens.borderDim}`,
              color: bentoTokens.muted,
              fontSize: 12.5,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {updateInfo.releaseNotes.trim()}
          </div>
        )}

        {downloading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="font-mono-tech" style={{ fontSize: 10.5, color: bentoTokens.accentLavender }}>
                {progress >= 99 ? 'ABRIENDO INSTALADOR…' : 'DESCARGANDO APK…'}
              </span>
              <span className="font-mono-tech" style={{ fontSize: 11, fontWeight: 700, color: bentoTokens.ink }}>
                {progress}%
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: 8,
                borderRadius: 999,
                backgroundColor: bentoTokens.bgSurface,
                overflow: 'hidden',
                border: `1px solid ${bentoTokens.borderDim}`,
              }}
            >
              <div
                style={{
                  width: `${Math.max(4, progress)}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${bentoTokens.accent}, ${bentoTokens.accentLavender})`,
                  transition: 'width 180ms ease-out',
                }}
              />
            </div>
          </div>
        )}

        {needsPermission && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              backgroundColor: 'rgba(168, 85, 247, 0.14)',
              border: `1px solid ${bentoTokens.accent}`,
              color: bentoTokens.ink,
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            Activa <strong>Permitir desde esta fuente</strong> en Ajustes de Android y vuelve a pulsar{' '}
            <strong>ACTUALIZAR AHORA</strong>.
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: 12,
              backgroundColor: 'rgba(239, 68, 68, 0.14)',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              color: '#FCA5A5',
              fontSize: 12,
            }}
          >
            {errorMsg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
          <button
            type="button"
            disabled={downloading}
            onClick={onClose}
            className="font-mono-tech ryo-pressable"
            style={{
              flex: 1,
              height: 40,
              borderRadius: 999,
              backgroundColor: bentoTokens.bgSurface,
              border: `1px solid ${bentoTokens.borderDim}`,
              color: bentoTokens.muted,
              fontSize: 11,
              fontWeight: 600,
              opacity: downloading ? 0.45 : 1,
              cursor: downloading ? 'not-allowed' : 'pointer',
            }}
          >
            MÁS TARDE
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={handleInstall}
            className="font-mono-tech ryo-pressable"
            style={{
              flex: 1.5,
              height: 40,
              borderRadius: 999,
              backgroundColor: bentoTokens.accent,
              border: 'none',
              color: '#FFFFFF',
              fontSize: 11.5,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              opacity: downloading ? 0.65 : 1,
              cursor: downloading ? 'wait' : 'pointer',
            }}
          >
            <Icon name="download" size={14} color="#FFFFFF" />
            <span>{downloading ? `${progress}%` : 'ACTUALIZAR AHORA'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
