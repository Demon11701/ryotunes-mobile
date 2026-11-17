import React from 'react';
import { useAudio } from '../audio/AudioContextProvider';
import { Icon } from '../icons/Icon';

export const Toast: React.FC = () => {
  const { toast } = useAudio();
  if (!toast) return null;

  const iconName = toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check-circle' : 'info';
  const iconColor = toast.kind === 'error' ? 'var(--alert)' : toast.kind === 'success' ? 'var(--sun)' : 'var(--ink-muted)';

  return (
    <div
      key={toast.id}
      className="osd-pop"
      style={{
        position: 'fixed',
        bottom: 'calc(var(--safe-bottom) + 92px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 95,
        backgroundColor: 'var(--paper-lift)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <Icon name={iconName} size={16} color={iconColor} />
      <span style={{ fontSize: 13.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {toast.text}
      </span>
    </div>
  );
};
