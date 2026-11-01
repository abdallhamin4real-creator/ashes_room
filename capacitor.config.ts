import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.manus.ashenroom',
  appName: 'غرفة الرماد',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    backgroundColor: '#0b0c0c',
    allowMixedContent: false,
  },
}

export default config
