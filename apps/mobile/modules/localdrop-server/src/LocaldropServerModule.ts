import { NativeModule, requireNativeModule } from 'expo';

import { LocaldropServerModuleEvents } from './LocaldropServer.types';

declare class LocaldropServerModule extends NativeModule<LocaldropServerModuleEvents> {
  startServer(port: number): Promise<boolean>;
  stopServer(): Promise<boolean>;
  requestAllFilesAccess(): Promise<boolean>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<LocaldropServerModule>('LocaldropServer');
