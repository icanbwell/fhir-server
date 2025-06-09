// some packages have removed support for commonjs and moved to ESM
// this configuration allows us to use those packages in a commonjs environment
module.exports = {
    env: {
        test: {
            plugins: [
                '@babel/plugin-transform-export-namespace-from',
                [
                    '@babel/plugin-transform-modules-commonjs',
                    {
                        targets: {
                            node: 'current'
                        }
                    }
                ]
            ]
        }
    }
};
