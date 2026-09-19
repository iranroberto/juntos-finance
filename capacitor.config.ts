import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.juntosfinance.app',
  appName: 'Juntos Finance',
  webDir: 'capacitor-web',
  server: {
    url: 'https://juntos-finance.vercel.app',
    cleartext: false,
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;