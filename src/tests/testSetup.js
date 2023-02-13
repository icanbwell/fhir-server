// ./testSetup.js
const {
    toHaveResponse,
    toHaveStatusCode,
    toHaveStatusOk,
    toHaveMergeResponse,
    toHaveResourceCount,
    toHaveGraphQLResponse
} = require('./customMatchers');

expect.extend({toHaveResponse, toHaveStatusCode, toHaveStatusOk, toHaveMergeResponse, toHaveResourceCount, toHaveGraphQLResponse});

const {
    toBeArray,
    toBeSealed,
    toBeTrue,
    toBeFalse,
    toStartWith,
    toEndWith,
    toInclude,
    toBeArrayOfSize
} = require('jest-extended');
expect.extend({toBeArray, toBeSealed, toBeTrue, toBeFalse, toStartWith, toEndWith, toInclude, toBeArrayOfSize});
