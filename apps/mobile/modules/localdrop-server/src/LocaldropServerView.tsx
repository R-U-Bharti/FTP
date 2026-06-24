import { requireNativeView } from 'expo';
import * as React from 'react';
import { Text } from 'react-native';

import { LocaldropServerViewProps } from './LocaldropServer.types';

// requireNativeView throws at import time in Expo Go / web. Guard it so
// importing this module never crashes the app; render a placeholder instead.
let NativeView: React.ComponentType<LocaldropServerViewProps> | null = null;
try {
  NativeView = requireNativeView('LocaldropServer');
} catch {
  NativeView = null;
}

export default function LocaldropServerView(props: LocaldropServerViewProps) {
  if (!NativeView) {
    return <Text>LocaldropServer native view requires a development build.</Text>;
  }
  return <NativeView {...props} />;
}
