const babelJest = require.resolve('babel-jest', { paths: [require.resolve('jest-config')] });

const esmOnlyPackages = [
    '@apollo/server-gateway-interface',
    '@graphql-tools/merge',
    '@hono/node-server',
    '@icanbwell/fhirpatientsummary',
    '@json2csv/formatters',
    '@json2csv/node',
    '@json2csv/plainjs',
    '@json2csv/transforms',
    '@kubernetes/client-node',
    '@streamparser/json',
    'ansi-regex',
    'ansi-styles',
    'cliui',
    'color',
    'color-convert',
    'color-name',
    'color-string',
    'csv42',
    'data-uri-to-buffer',
    'fetch-blob',
    'formdata-polyfill',
    'get-east-asian-width',
    'import-meta-resolve',
    'jose',
    'js-tokens',
    'node-fetch',
    'oauth4webapi',
    'obug',
    'openid-client',
    'string-width',
    'strip-ansi',
    'uuid',
    'verkit',
    'wrap-ansi',
    'yargs',
    'yargs-parser'
];

const transformedFiles = ['mongodb/lib/runtime_adapters\\.js$'];

const transformIgnorePatterns = [
    `node_modules/(?!(?:${esmOnlyPackages.join('|')})/|${transformedFiles.join('|')})(?!.*node_modules/)`
];

const transform = {
    '\\.test\\.js$': babelJest,
    [`node_modules/(?:(?:${esmOnlyPackages.join('|')})/|${transformedFiles.join('|')})`]: babelJest
};

module.exports = { esmOnlyPackages, transform, transformIgnorePatterns };
