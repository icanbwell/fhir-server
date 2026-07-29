'use strict';

const { describe, test, expect } = require('@jest/globals');
const { EntityAndContainedBase } = require('../../../../operations/graph/entityAndContainedBase');

describe('EntityAndContainedBase', () => {
    test('stores includeInOutput true', () => {
        const entity = new EntityAndContainedBase({ includeInOutput: true });
        expect(entity.includeInOutput).toBe(true);
    });

    test('stores includeInOutput false', () => {
        const entity = new EntityAndContainedBase({ includeInOutput: false });
        expect(entity.includeInOutput).toBe(false);
    });
});
