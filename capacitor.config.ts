import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.itfix.assets',
  appName: 'IT Fix - Asset Management',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    backgroundColor: '#F4F7FA',
    allowMixedContent: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#183B56',
      showSpinner: false
    }
  }
};

export default config;
