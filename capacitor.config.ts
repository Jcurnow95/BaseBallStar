import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.baseballstar.app',
  appName: 'Baseball Star',
  webDir: 'dist',
  android: {
    // The at-bat minigame is timing-critical; let it own every touch.
    allowMixedContent: false,
    backgroundColor: '#0b1220',
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#0b1220',
    // Stops the WebView bouncing when a player swipes during a pitch.
    scrollEnabled: false,
  },
  plugins: {
    SplashScreen: {
      // Hidden from JS once the first screen has rendered, rather than on a
      // timer — a fixed delay either flashes the splash away too early or
      // holds it after the game is already up.
      launchAutoHide: false,
      backgroundColor: '#0b1220',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      // The app is dark throughout, so the clock and battery need light icons.
      style: 'DARK',
      backgroundColor: '#0b1220',
      overlaysWebView: false,
    },
  },
};

export default config;
