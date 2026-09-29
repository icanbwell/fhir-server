'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

const { ResourceEntityAndContained } = require('../../../../operations/graph/resourceEntityAndContained');
const { EntityAndContainedBase } = require('../../../../operations/graph/entityAndContainedBase');

describe('ResourceEntityAndContained', () => {
    test('extends EntityAndContainedBase', () => {
        const entity = new ResourceEntityAndContained({
            entityId: 'p1',
            entityUuid: 'uuid-1',
            entityResourceType: 'Patient',
            includeInOutput: true,
            resource: { id: 'p1', resourceType: 'Patient' },
            containedEntries: []
        });
        expect(entity).toBeInstanceOf(EntityAndContainedBase);
    });

    test('stores all properties', () => {
        const resource = { id: 'obs-1', resourceType: 'Observation' };
        const contained = [new EntityAndContainedBase({ includeInOutput: false })];
        const entity = new ResourceEntityAndContained({
            entityId: 'obs-1',
            entityUuid: 'uuid-obs-1',
            entityResourceType: 'Observation',
            includeInOutput: false,
            resource,
            containedEntries: contained
        });

        expect(entity.entityId).toBe('obs-1');
        expect(entity.entityUuid).toBe('uuid-obs-1');
        expect(entity.entityResourceType).toBe('Observation');
        expect(entity.includeInOutput).toBe(false);
        expect(entity.resource).toBe(resource);
        expect(entity.containedEntries).toBe(contained);
    });
});
