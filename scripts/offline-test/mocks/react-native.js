// Minimal RN stub so esbuild never parses the real Flow-typed package.
module.exports = {
  Platform: { OS: 'ios', select: (o) => o.ios ?? o.default },
};
