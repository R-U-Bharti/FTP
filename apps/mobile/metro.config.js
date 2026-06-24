// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// pnpm keeps the real package files in an external virtual store
// (see .npmrc -> virtual-store-dir=D:\.ps). The package dirs under
// node_modules are symlinks into it, so Metro must watch & resolve there
// or it fails with "could not be found within the project".
const pnpmStore = 'D:\\.ps';

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot, pnpmStore];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
