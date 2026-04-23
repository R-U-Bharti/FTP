// Reexport the native module. On web, it will be resolved to LocaldropServerModule.web.ts
// and on native platforms to LocaldropServerModule.ts
export { default } from './src/LocaldropServerModule';
export { default as LocaldropServerView } from './src/LocaldropServerView';
export * from  './src/LocaldropServer.types';
