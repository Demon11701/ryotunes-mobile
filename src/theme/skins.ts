export interface PaletteMode {
  paper: string;
  paperLift: string;
  ink: string;
  inkDim: string;
  bone: string;
  inkOnBone: string;
  sun: string;
  alert: string;
}

export interface RyotunesSkin {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  previewUrl: string;
  defaultMode: 'dark' | 'light';
  modes: {
    dark?: PaletteMode;
    light?: PaletteMode;
  };
  type: {
    display: string;
    ui: string;
    mono: string;
  };
  shape: {
    radius: number;
    radiusCard: number;
  };
  motion: {
    snap: number;
    move: number;
    swap: number;
    slow: number;
  };
  decor: 'rich' | 'calm';
  accent: 'artwork' | 'sun' | 'provider' | string;
  wash: number;
}

export const PROVIDER_COLORS: Record<string, string> = {
  youtube: '#ff2d2d',
  spotify: '#1db954',
  soundcloud: '#ff5500',
  tidal: '#4fc3dc',
  local: '#A855F7',
  offline: '#C084FC',
  demo: '#A855F7',
};

/**
 * 11 Skins:
 * - `ryoku-purple` from ~/.local/state/quickshell/user/generated/colors.json
 * - 10 official skins from /usr/share/ryotunes/skins/<id>/skin.json
 */
export const SKINS: RyotunesSkin[] = [
  {
    id: 'ryoku-purple',
    name: 'Ryoku Purple',
    author: 'Ryoku × Quickshell',
    version: '1.2.6',
    description: 'Nothing OS × Ryoku Purple Material 3 palette from colors.json.',
    previewUrl: '/skins/ryoku-purple/preview.png',
    defaultMode: 'dark',
    modes: {
      dark: {
        paper: '#16111b',
        paperLift: '#1f1a23',
        ink: '#eadfed',
        inkDim: '#cfc2d6',
        bone: '#eadfed',
        inkOnBone: '#342e38',
        sun: '#ddb7ff',
        alert: '#ffb4ab',
      },
    },
    type: {
      display: "'Ndot 57', 'Space Grotesk', sans-serif",
      ui: "'Space Grotesk', system-ui, sans-serif",
      mono: "'Space Mono', monospace",
    },
    shape: { radius: 8, radiusCard: 14 },
    motion: { snap: 80, move: 160, swap: 200, slow: 180 },
    decor: 'rich',
    accent: '#A855F7',
    wash: 1.25,
  },
  {
    id: 'paper',
    name: 'Paper',
    author: 'Ryoku',
    version: '1.0.0',
    description: "Ryotunes' own: pure-black paper, warm bone ink, one red sun.",
    previewUrl: '/skins/paper/preview.png',
    defaultMode: 'dark',
    modes: {
      dark: {
        paper: '#050505',
        paperLift: '#0d0d0c',
        ink: '#d7cfc6',
        inkDim: '#b6aea5',
        bone: '#d7cfc6',
        inkOnBone: '#090807',
        sun: '#e2342a',
        alert: '#d33b32',
      },
      light: {
        paper: '#c8c4bc',
        paperLift: '#d5d0c7',
        ink: '#211f1c',
        inkDim: '#403b35',
        bone: '#292620',
        inkOnBone: '#eee8de',
        sun: '#e2342a',
        alert: '#d33b32',
      },
    },
    type: {
      display: "'Fraunces', Georgia, serif",
      ui: "'Space Grotesk', sans-serif",
      mono: "'Space Mono', monospace",
    },
    shape: { radius: 8, radiusCard: 12 },
    motion: { snap: 90, move: 170, swap: 210, slow: 200 },
    decor: 'rich',
    accent: 'artwork',
    wash: 1.0,
  },
  {
    id: 'arcade',
    name: 'Arcade',
    author: 'Ryoku',
    version: '1.0.0',
    description: '8-bit cabinet: indigo paper, coin-yellow bone, Silkscreen titles, provider light.',
    previewUrl: '/skins/arcade/preview.png',
    defaultMode: 'dark',
    modes: {
      dark: {
        paper: '#170e33',
        paperLift: '#251852',
        ink: '#fff5c2',
        inkDim: '#d6c78c',
        bone: '#ffd23f',
        inkOnBone: '#1a1036',
        sun: '#ff3d7f',
        alert: '#ff3d3d',
      },
    },
    type: {
      display: "'Silkscreen', monospace",
      ui: "'Outfit', sans-serif",
      mono: "'Press Start 2P', monospace",
    },
    shape: { radius: 0, radiusCard: 0 },
    motion: { snap: 50, move: 100, swap: 130, slow: 120 },
    decor: 'rich',
    accent: 'provider',
    wash: 1.2,
  },
  {
    id: 'broadsheet',
    name: 'Broadsheet',
    author: 'Ryoku',
    version: '1.0.0',
    description: 'Newsprint: warm off-white paper, black ink, deep-red sun, Playfair + IBM Plex.',
    previewUrl: '/skins/broadsheet/preview.png',
    defaultMode: 'light',
    modes: {
      light: {
        paper: '#f3efe6',
        paperLift: '#e8e2d4',
        ink: '#14110d',
        inkDim: '#4a443c',
        bone: '#14110d',
        inkOnBone: '#f3efe6',
        sun: '#b3261e',
        alert: '#b3261e',
      },
      dark: {
        paper: '#17140f',
        paperLift: '#221e18',
        ink: '#efe8da',
        inkDim: '#b8b0a2',
        bone: '#efe8da',
        inkOnBone: '#17140f',
        sun: '#e0553f',
        alert: '#e0553f',
      },
    },
    type: {
      display: "'Playfair Display', Georgia, serif",
      ui: "'IBM Plex Sans', sans-serif",
      mono: "'Space Mono', monospace",
    },
    shape: { radius: 0, radiusCard: 2 },
    motion: { snap: 90, move: 170, swap: 210, slow: 200 },
    decor: 'rich',
    accent: 'sun',
    wash: 0.3,
  },
  {
    id: 'concrete',
    name: 'Concrete',
    author: 'Ryoku',
    version: '1.0.0',
    description: 'Brutalist: grey slab, black ink, safety-orange everything, zero radius.',
    previewUrl: '/skins/concrete/preview.png',
    defaultMode: 'light',
    modes: {
      light: {
        paper: '#e4e4e4',
        paperLift: '#f1f1f1',
        ink: '#0a0a0a',
        inkDim: '#3a3a3a',
        bone: '#0a0a0a',
        inkOnBone: '#ffffff',
        sun: '#e63200',
        alert: '#e63200',
      },
      dark: {
        paper: '#111111',
        paperLift: '#1c1c1c',
        ink: '#f0f0f0',
        inkDim: '#b5b5b5',
        bone: '#f0f0f0',
        inkOnBone: '#111111',
        sun: '#ff3b00',
        alert: '#ff3b00',
      },
    },
    type: {
      display: "'Bebas Neue', sans-serif",
      ui: "'Manrope', sans-serif",
      mono: "'Space Mono', monospace",
    },
    shape: { radius: 0, radiusCard: 0 },
    motion: { snap: 40, move: 80, swap: 100, slow: 80 },
    decor: 'calm',
    accent: '#ff3b00',
    wash: 0.0,
  },
  {
    id: 'ember',
    name: 'Ember',
    author: 'Ryoku',
    version: '1.0.0',
    description: 'Warm dark: deep-umber paper, warm bone ink, one amber sun.',
    previewUrl: '/skins/ember/preview.png',
    defaultMode: 'dark',
    modes: {
      dark: {
        paper: '#17110d',
        paperLift: '#221812',
        ink: '#ecdfce',
        inkDim: '#c3ad93',
        bone: '#ecdcc4',
        inkOnBone: '#1c130a',
        sun: '#f0a12a',
        alert: '#e5533b',
      },
      light: {
        paper: '#e9ddca',
        paperLift: '#f0e6d6',
        ink: '#3a2b1c',
        inkDim: '#6b5540',
        bone: '#3a2b1c',
        inkOnBone: '#f3e9d8',
        sun: '#b26410',
        alert: '#c23b28',
      },
    },
    type: {
      display: "'Fraunces', Georgia, serif",
      ui: "'Space Grotesk', sans-serif",
      mono: "'Space Mono', monospace",
    },
    shape: { radius: 8, radiusCard: 12 },
    motion: { snap: 90, move: 170, swap: 210, slow: 200 },
    decor: 'rich',
    accent: 'sun',
    wash: 1.15,
  },
  {
    id: 'mist',
    name: 'Mist',
    author: 'Ryoku',
    version: '1.0.0',
    description: 'Light-first: fog paper, slate-navy ink, quiet teal sun.',
    previewUrl: '/skins/mist/preview.png',
    defaultMode: 'light',
    modes: {
      light: {
        paper: '#e7ecef',
        paperLift: '#f1f4f6',
        ink: '#24333f',
        inkDim: '#516470',
        bone: '#24333f',
        inkOnBone: '#eef3f5',
        sun: '#0d6e6e',
        alert: '#c2402f',
      },
      dark: {
        paper: '#161d22',
        paperLift: '#1f272d',
        ink: '#d5dee4',
        inkDim: '#93a4ae',
        bone: '#d5dee4',
        inkOnBone: '#141b20',
        sun: '#3fb6b0',
        alert: '#e4695a',
      },
    },
    type: {
      display: "'Fraunces', Georgia, serif",
      ui: "'Space Grotesk', sans-serif",
      mono: "'Space Mono', monospace",
    },
    shape: { radius: 10, radiusCard: 14 },
    motion: { snap: 100, move: 180, swap: 220, slow: 220 },
    decor: 'calm',
    accent: 'sun',
    wash: 0.6,
  },
  {
    id: 'neon',
    name: 'Neon',
    author: 'Ryoku',
    version: '1.0.0',
    description: 'Tokyo after midnight: ink-blue paper, hot magenta bone, cyan sun.',
    previewUrl: '/skins/neon/preview.png',
    defaultMode: 'dark',
    modes: {
      dark: {
        paper: '#07060f',
        paperLift: '#120f2a',
        ink: '#e8e6ff',
        inkDim: '#aaa6dc',
        bone: '#ff2bd6',
        inkOnBone: '#12041a',
        sun: '#19f0ff',
        alert: '#ff4d6d',
      },
    },
    type: {
      display: "'Unbounded', sans-serif",
      ui: "'Outfit', sans-serif",
      mono: "'Share Tech Mono', monospace",
    },
    shape: { radius: 2, radiusCard: 4 },
    motion: { snap: 60, move: 120, swap: 160, slow: 150 },
    decor: 'rich',
    accent: 'sun',
    wash: 1.6,
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    author: 'Ryoku',
    version: '1.0.0',
    description: 'Green-phosphor terminal: black glass, P1 green ink, amber sun.',
    previewUrl: '/skins/phosphor/preview.png',
    defaultMode: 'dark',
    modes: {
      dark: {
        paper: '#040704',
        paperLift: '#0a120a',
        ink: '#9dff9d',
        inkDim: '#62c062',
        bone: '#9dff9d',
        inkOnBone: '#031003',
        sun: '#ffbf00',
        alert: '#ff5a3c',
      },
    },
    type: {
      display: "'Major Mono Display', monospace",
      ui: "'Share Tech Mono', monospace",
      mono: "'VT323', monospace",
    },
    shape: { radius: 0, radiusCard: 0 },
    motion: { snap: 40, move: 90, swap: 120, slow: 100 },
    decor: 'calm',
    accent: 'sun',
    wash: 0.0,
  },
  {
    id: 'vapor',
    name: 'Vapor',
    author: 'Ryoku',
    version: '1.0.0',
    description: 'Vaporwave: violet paper, pink bone, teal sun, cover melting over all.',
    previewUrl: '/skins/vapor/preview.png',
    defaultMode: 'dark',
    modes: {
      dark: {
        paper: '#241542',
        paperLift: '#33225c',
        ink: '#ffe9f7',
        inkDim: '#d9bce8',
        bone: '#ff9ad5',
        inkOnBone: '#2a1146',
        sun: '#7cf3e0',
        alert: '#ff6b9d',
      },
    },
    type: {
      display: "'Playfair Display', Georgia, serif",
      ui: "'Montserrat', sans-serif",
      mono: "'VT323', monospace",
    },
    shape: { radius: 16, radiusCard: 24 },
    motion: { snap: 140, move: 260, swap: 320, slow: 400 },
    decor: 'rich',
    accent: 'artwork',
    wash: 1.8,
  },
  {
    id: 'velvet',
    name: 'Velvet',
    author: 'Ryoku',
    version: '1.0.0',
    description: 'Lounge at closing time: wine-dark paper, gilt bone and sun.',
    previewUrl: '/skins/velvet/preview.png',
    defaultMode: 'dark',
    modes: {
      dark: {
        paper: '#1a0a11',
        paperLift: '#29121f',
        ink: '#f5dcc7',
        inkDim: '#cfa993',
        bone: '#d9b64a',
        inkOnBone: '#1f0c14',
        sun: '#d9b64a',
        alert: '#ff6f61',
      },
    },
    type: {
      display: "'Cormorant Garamond', Georgia, serif",
      ui: "'DM Sans', sans-serif",
      mono: "'Space Mono', monospace",
    },
    shape: { radius: 12, radiusCard: 20 },
    motion: { snap: 120, move: 240, swap: 300, slow: 360 },
    decor: 'rich',
    accent: 'sun',
    wash: 1.4,
  },
];

export function getSkinById(id: string): RyotunesSkin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
