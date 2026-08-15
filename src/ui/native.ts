import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { App } from '../app';
import { resumeAmbience, suspendAmbience } from './audio';

/**
 * The bits of "being an app" that a browser gives you for free and a phone
 * doesn't: a hardware back button, a status bar that has to be told the app is
 * dark, a splash screen that has to be dismissed by hand, and a process that
 * gets suspended rather than closed.
 *
 * Every call here is a no-op on the web, so `main.ts` can call it
 * unconditionally and the dev server keeps working exactly as before.
 */
export function initNative(app: App): void {
  if (!Capacitor.isNativePlatform()) return;

  // Style.Dark means *light* icons for a dark background, which is the whole
  // app. The default assumes a white page and renders the clock invisible.
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});

  // Dismissed here rather than on a timer, so it covers exactly the gap until
  // the first screen is actually on-screen.
  requestAnimationFrame(() => {
    SplashScreen.hide().catch(() => {});
  });

  void CapApp.addListener('backButton', () => {
    if (app.back() === 'exit') void CapApp.exitApp();
  });

  // Backgrounding should silence the crowd — otherwise the bed keeps streaming
  // over whatever the player switched to. Suspend rather than stop, so coming
  // back mid-game brings it with you.
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) resumeAmbience();
    else suspendAmbience();
  });
}
