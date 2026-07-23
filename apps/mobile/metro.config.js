// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Web platform stubs: react-native-maps' entry point imports native-only
// codegen at module scope, so Metro can't bundle it for web even though
// our screens guard `require()` calls at runtime. Alias to a no-op
// module so web builds succeed; native builds get the real package.
const NATIVE_ONLY_WEB_STUBS = {
  'react-native-maps': path.resolve(__dirname, 'lib/react-native-maps-web-stub.js'),
};

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && NATIVE_ONLY_WEB_STUBS[moduleName]) {
    return {
      filePath: NATIVE_ONLY_WEB_STUBS[moduleName],
      type: 'sourceFile',
    };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
