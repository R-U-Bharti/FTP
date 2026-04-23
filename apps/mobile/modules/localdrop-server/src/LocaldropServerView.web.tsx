import * as React from 'react';

import { LocaldropServerViewProps } from './LocaldropServer.types';

export default function LocaldropServerView(props: LocaldropServerViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
