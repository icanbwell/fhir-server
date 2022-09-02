// ./testSetup.js
const {
    toHaveResponse,
    toHaveStatusCode,
    toHaveStatusOk,
    toHaveMergeResponse,
    toHaveResourceCount
} = require('./customMatchers');

expect.extend({toHaveResponse, toHaveStatusCode, toHaveStatusOk, toHaveMergeResponse, toHaveResourceCount});

const {toBeArray, toBeSealed} = require('jest-extended');
expect.extend({toBeArray, toBeSealed});
