// some packages have removed support for commonjs and moved to ESM
// this configuration allows us to use those packages in a commonjs environment
module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current'
        }
      }
    ]
  ],
  plugins: [
    '@babel/plugin-transform-export-namespace-from'
  ],
  env: {
    test: {
      plugins: [
        '@babel/plugin-transform-modules-commonjs'
      ]
    }
  }
};
