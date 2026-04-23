import { requireNativeView } from 'expo';
import * as React from 'react';

import { LocaldropServerViewProps } from './LocaldropServer.types';

const NativeView: React.ComponentType<LocaldropServerViewProps> =
  requireNativeView('LocaldropServer');

export default function LocaldropServerView(props: LocaldropServerViewProps) {
  return <NativeView {...props} />;
}
