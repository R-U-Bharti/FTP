import { NativeModule, requireNativeModule } from 'expo';

import { LocaldropServerModuleEvents } from './LocaldropServer.types';

declare class LocaldropServerModule extends NativeModule<LocaldropServerModuleEvents> {
  startServer(port: number): Promise<boolean>;
  stopServer(): Promise<boolean>;
  requestAllFilesAccess(): Promise<boolean>;
  /** Tell the native server which folder is currently shared, so PC→phone uploads
   *  targeting the explorer root (".") land in the right place. */
  setSharedRoot(uri: string): Promise<boolean>;
}

// Whether the real Kotlin native module is loaded. False in Expo Go / web,
// where custom native modules are never bundled.
export let isNativeAvailable = false;

// In Expo Go (and web) requireNativeModule() throws at import time, which
// crashes the entire app on launch. Fall back to a no-op stub so the
// JS-only features (PC transfer over socket.io + expo-file-system) keep
// working. The native HTTP server and all-files access need a development
// build (npx expo run:android), not Expo Go.
function loadModule(): LocaldropServerModule {
  try {
    const mod = requireNativeModule<LocaldropServerModule>('LocaldropServer');
    isNativeAvailable = true;
    return mod;
  } catch {
    const warn = (name: string) =>
      console.warn(
        `[LocaldropServer] native module unavailable (Expo Go?). "${name}" is a no-op. ` +
          `Run a development build for the native HTTP server: npx expo run:android`,
      );
    return {
      startServer: async () => {
        warn('startServer');
        return false;
      },
      stopServer: async () => {
        warn('stopServer');
        return false;
      },
      requestAllFilesAccess: async () => {
        warn('requestAllFilesAccess');
        return false;
      },
      setSharedRoot: async () => {
        warn('setSharedRoot');
        return false;
      },
    } as unknown as LocaldropServerModule;
  }
}

// This call loads the native module object from the JSI.
export default loadModule();
