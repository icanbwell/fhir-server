// ./testSetup.js
const {toHaveResponse, toHaveStatusCode, toHaveStatusOk} = require('./customMatchers');

expect.extend({toHaveResponse, toHaveStatusCode, toHaveStatusOk});

const {toBeArray, toBeSealed} = require('jest-extended');
expect.extend({toBeArray, toBeSealed});
