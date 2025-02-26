module.exports = {
  presets: [
    ['@babel/preset-env', {
      targets: {
        node: '20.13.1' // Your specific Node version
      },
      modules: 'commonjs' // Explicitly set to CommonJS
    }]
  ]
};
