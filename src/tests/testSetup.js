// ./testSetup.js
const {
    toHaveResponse,
    toHaveStatusCode,
    toHaveStatusOk,
    toHaveMergeResponse,
    toHaveResourceCount,
    toHaveGraphQLResponse,
    sortEntriesByUUID,
    toHaveMongoQuery
} = require('./customMatchers');

const { expect } = require('@jest/globals');

expect.extend({
    toHaveResponse,
    toHaveStatusCode,
    toHaveStatusOk,
    toHaveMergeResponse,
    toHaveResourceCount,
    toHaveGraphQLResponse,
    sortEntriesByUUID,
    toHaveMongoQuery
});

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
expect.extend({ toBeArray, toBeSealed, toBeTrue, toBeFalse, toStartWith, toEndWith, toInclude, toBeArrayOfSize });
