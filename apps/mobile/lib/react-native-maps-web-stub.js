// Stub for react-native-maps on the web platform.
//
// react-native-maps imports native-only modules at the top level of its
// entry point, so Metro's static analysis can't be bypassed by the
// `if (Platform.OS !== 'web') require(...)` pattern in our code. Web
// builds end up trying to bundle codegenNativeCommands and crash.
//
// Aliasing the package to this no-op module in metro.config.js (web
// platform only) lets the bundle succeed. The screens already handle
// the case where MapView et al are null at runtime (see the conditional
// require + null checks in (user)/index.tsx and LocationPicker.tsx).

module.exports = {
  __esModule: true,
  default: null,
  Marker: null,
  MarkerAnimated: null,
  Polyline: null,
  AnimatedRegion: null,
  PROVIDER_GOOGLE: null,
  PROVIDER_DEFAULT: null,
};
