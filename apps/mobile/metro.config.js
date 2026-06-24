// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Always watch the monorepo root so workspace packages resolve.
const watchFolders = [workspaceRoot];

// pnpm keeps the real package files in a virtual store. Locally on Windows it
// is relocated to D:\.ps (see root .npmrc, done to stay under the Windows path
// length limit); on CI/EAS (Linux) it lives at the default node_modules/.pnpm
// inside the workspace, which is already covered by watching workspaceRoot.
// Only add an external store to watchFolders when it actually exists —
// otherwise Metro crashes trying to watch a missing path (breaks EAS builds).
const candidateStores = ['D:\\.ps', path.resolve(workspaceRoot, 'node_modules/.pnpm')];
for (const store of candidateStores) {
  if (fs.existsSync(store) && !watchFolders.includes(store)) {
    watchFolders.push(store);
  }
}

config.watchFolders = watchFolders;

// Pin Metro's server root to this app. Watching folders outside the app (the
// workspace root, and the external D:\.ps pnpm store on Windows) otherwise
// pushes Metro's computed server root up the tree, which makes `expo
// export:embed` (the Gradle "createBundle…JsAndAssets" task) rebase the entry
// to the wrong root and fail with "Unable to resolve module ./index.ts".
config.server = { ...config.server, unstable_serverRoot: projectRoot };

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
