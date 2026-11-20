import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.ryoku.ryotunes',
  appName: 'Ryotunes',
  webDir: 'dist',
  backgroundColor: '#0B0910',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#0B0910',
    },
  },
};

export default config;
