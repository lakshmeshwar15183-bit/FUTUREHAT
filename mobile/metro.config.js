// FUTUREHAT mobile — Metro config that lets the Expo app consume the
// monorepo `shared/` TypeScript package directly.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const sharedRoot = path.resolve(workspaceRoot, 'shared');

const config = getDefaultConfig(projectRoot);

// 1. Watch the shared package so Metro bundles + hot-reloads its source.
config.watchFolders = [sharedRoot];

// 2. Resolve dependencies from the app first, then the shared package.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(sharedRoot, 'node_modules'),
];

// 3. shared/* is authored with NodeNext-style explicit ".js" extensions on
//    relative imports (e.g. `from './types.js'`). Metro doesn't rewrite those
//    to the ".ts" source automatically, so do it here.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(
        context,
        moduleName.replace(/\.js$/, '.ts'),
        platform,
      );
    } catch {
      // fall through to the default resolver below
    }
  }
  const resolver = defaultResolveRequest || context.resolveRequest;
  return resolver(context, moduleName, platform);
};

module.exports = config;
