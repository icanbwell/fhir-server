'use strict';

const { describe, test, expect } = require('@jest/globals');

describe('operations/common/types', () => {
    test('module exports a typedef comment only (no runtime exports)', () => {
        const types = require('../../../../operations/common/types');
        // The module only contains JSDoc typedefs, no actual exports
        expect(types).toEqual({});
    });
});
