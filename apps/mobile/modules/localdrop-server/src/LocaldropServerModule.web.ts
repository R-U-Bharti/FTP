import { registerWebModule, NativeModule } from 'expo';

import { ChangeEventPayload } from './LocaldropServer.types';

type LocaldropServerModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
}

class LocaldropServerModule extends NativeModule<LocaldropServerModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
};

export default registerWebModule(LocaldropServerModule, 'LocaldropServerModule');
