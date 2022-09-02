// ./testSetup.js
const {toHaveResponse} = require('./customMatchers');

expect.extend({toHaveResponse});

const {toBeArray, toBeSealed} = require('jest-extended');
expect.extend({toBeArray, toBeSealed});
