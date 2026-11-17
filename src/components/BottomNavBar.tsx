import React from 'react';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/ThemeContext';

export type MainTab = 'stage' | 'explore' | 'library' | 'studio';

interface BottomNavBarProps {
  activeTab: MainTab;
  onSelectTab: (tab: MainTab) => void;
}

const TABS: { key: MainTab; num: string; label: string; icon: string }[] = [
  { key: 'stage', num: '01', label: 'STAGE', icon: 'cd' },
  { key: 'explore', num: '02', label: 'EXPLORE', icon: 'search' },
  { key: 'library', num: '03', label: 'LIBRARY', icon: 'library' },
  { key: 'studio', num: '04', label: 'STUDIO', icon: 'settings' },
];

/**
 * Fixed ergonomic 4-tab mobile navigation bar (01 · STAGE, 02 · EXPLORE, 03 · LIBRARY, 04 · STUDIO).
 */
export const BottomNavBar: React.FC<BottomNavBarProps> = ({ activeTab, onSelectTab }) => {
  const { bentoTokens } = useTheme();
  const stageSurface = activeTab === 'stage';

  return (
    <nav
      aria-label="Primary sections"
      style={{
        flexShrink: 0,
        zIndex: 30,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
        paddingTop: 6,
        paddingLeft: 'calc(var(--safe-left) + 10px)',
        paddingRight: 'calc(var(--safe-right) + 10px)',
        paddingBottom: 'calc(var(--safe-bottom) + 8px)',
        backgroundColor: stageSurface ? bentoTokens.bgDeep : 'var(--paper)',
        borderTop: `1px solid ${stageSurface ? bentoTokens.borderDim : 'var(--line-soft)'}`,
        backdropFilter: 'blur(12px)',
      }}
    >
      {TABS.map((t) => {
        const active = activeTab === t.key;
        const accentColor = stageSurface ? bentoTokens.accent : 'var(--accent)';
        const inkColor = stageSurface ? bentoTokens.ink : 'var(--ink)';
        const mutedColor = stageSurface ? bentoTokens.muted : 'var(--ink-muted)';
        const activeBg = stageSurface ? bentoTokens.glowSoft : 'var(--tint-5)';

        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelectTab(t.key)}
            aria-current={active ? 'page' : undefined}
            className="ryo-pressable"
            style={{
              position: 'relative',
              height: 46,
              borderRadius: 12,
              border: `1px solid ${active ? accentColor : 'transparent'}`,
              backgroundColor: active ? activeBg : 'transparent',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            <Icon name={t.icon} size={16} color={active ? accentColor : mutedColor} />
            <span
              style={{
                fontFamily: stageSurface ? bentoTokens.fontMono : undefined,
                fontSize: 8.5,
                fontWeight: active ? 700 : 500,
                letterSpacing: 0.7,
                color: active ? inkColor : mutedColor,
                whiteSpace: 'nowrap',
              }}
              className={stageSurface ? undefined : 'font-mono-tech'}
            >
              {t.num} · {t.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
