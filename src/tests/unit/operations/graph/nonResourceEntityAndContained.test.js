'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

const { NonResourceEntityAndContained } = require('../../../../operations/graph/nonResourceEntityAndContained');
const { EntityAndContainedBase } = require('../../../../operations/graph/entityAndContainedBase');

describe('NonResourceEntityAndContained', () => {
    test('extends EntityAndContainedBase', () => {
        const entity = new NonResourceEntityAndContained({
            includeInOutput: true,
            item: { name: 'test' },
            containedEntries: []
        });
        expect(entity).toBeInstanceOf(EntityAndContainedBase);
    });

    test('stores item and containedEntries', () => {
        const item = { field: 'value' };
        const containedEntries = [new EntityAndContainedBase({ includeInOutput: false })];
        const entity = new NonResourceEntityAndContained({
            includeInOutput: true,
            item,
            containedEntries
        });

        expect(entity.item).toBe(item);
        expect(entity.containedEntries).toBe(containedEntries);
        expect(entity.includeInOutput).toBe(true);
    });
});
