const { describe, beforeAll, afterAll, test, expect } = require('@jest/globals');
const { ResourceSizeValidator } = require('../../../operations/merge/validators/resourceSizeValidator');
const { ResourceValidator } = require('../../../operations/common/resourceValidator');
const { ConfigManager } = require('../../../utils/configManager');
const { MergeResultEntry } = require('../../../operations/common/mergeResultEntry');

/**
 * Builds a ResourceSizeValidator wired to a real ResourceValidator (so the actual
 * validateResourceSizeSync logic runs) without instantiating ResourceValidator's heavy
 * dependency graph. assertTypeEquals only checks `instanceof`, so an object created from
 * the prototype with just configManager attached satisfies the contract and uses the real
 * size-check method.
 */
function buildValidator () {
    const resourceValidator = Object.create(ResourceValidator.prototype);
    resourceValidator.configManager = new ConfigManager();
    return new ResourceSizeValidator({ resourceValidator });
}

/**
 * @param {number} entityCount number of entity[] entries to pad the payload size
 */
function makeAuditEvent (entityCount, id = 'ae-1') {
    return {
        resourceType: 'AuditEvent',
        id,
        entity: Array.from({ length: entityCount }, (_v, i) => ({
            what: { reference: `Observation/obs-${i}` }
        }))
    };
}

describe('ResourceSizeValidator', () => {
    const ORIGINAL_LIMIT = process.env.AUDIT_EVENT_MAX_SIZE_BYTES;

    beforeAll(() => {
        // Small limit so a handful of entities is enough to trip it.
        process.env.AUDIT_EVENT_MAX_SIZE_BYTES = '500';
    });

    afterAll(() => {
        if (ORIGINAL_LIMIT === undefined) {
            delete process.env.AUDIT_EVENT_MAX_SIZE_BYTES;
        } else {
            process.env.AUDIT_EVENT_MAX_SIZE_BYTES = ORIGINAL_LIMIT;
        }
    });

    test('passes a single AuditEvent under the limit and keeps single-object shape', async () => {
        const validator = buildValidator();
        const resource = makeAuditEvent(2);

        const result = await validator.validate({ incomingResources: resource });

        expect(result.wasAList).toBe(false);
        expect(result.preCheckErrors).toHaveLength(0);
        // single-in => single-out (not wrapped in an array)
        expect(Array.isArray(result.validatedObjects)).toBe(false);
        expect(result.validatedObjects).toBe(resource);
    });

    test('rejects a single oversized AuditEvent with a too-long error and empty survivors', async () => {
        const validator = buildValidator();
        const resource = makeAuditEvent(100, 'too-big');

        const result = await validator.validate({ incomingResources: resource });

        expect(result.wasAList).toBe(false);
        expect(result.preCheckErrors).toHaveLength(1);
        // empty array (not null) so downstream MergeResourceValidator does not deref null
        expect(result.validatedObjects).toEqual([]);

        const [entry] = result.preCheckErrors;
        expect(entry).toBeInstanceOf(MergeResultEntry);
        expect(entry.id).toBe('too-big');
        expect(entry.resourceType).toBe('AuditEvent');
        expect(entry.created).toBe(false);
        expect(entry.updated).toBe(false);
        expect(entry.issue.code).toBe('too-long');
        expect(entry.operationOutcome.issue[0].details.text).toBe('Payload size too large.');
    });

    test('drops only oversized entries from a mixed list and preserves list shape', async () => {
        const validator = buildValidator();
        const small = makeAuditEvent(2, 'small');
        const big = makeAuditEvent(100, 'big');

        const result = await validator.validate({ incomingResources: [small, big] });

        expect(result.wasAList).toBe(true);
        expect(result.validatedObjects).toEqual([small]);
        expect(result.preCheckErrors).toHaveLength(1);
        expect(result.preCheckErrors[0].id).toBe('big');
    });

    test('does not size-check non-AuditEvent resources', async () => {
        const validator = buildValidator();
        // Observation with a large body would blow the AuditEvent limit, but it is not an AuditEvent.
        const observation = {
            resourceType: 'Observation',
            id: 'obs-big',
            component: Array.from({ length: 100 }, (_v, i) => ({
                valueString: `filler-${i}`
            }))
        };

        const result = await validator.validate({ incomingResources: observation });

        expect(result.preCheckErrors).toHaveLength(0);
        expect(result.validatedObjects).toBe(observation);
    });

    test('rejects every entry when all are oversized', async () => {
        const validator = buildValidator();
        const resources = [makeAuditEvent(100, 'a'), makeAuditEvent(100, 'b')];

        const result = await validator.validate({ incomingResources: resources });

        expect(result.wasAList).toBe(true);
        expect(result.validatedObjects).toEqual([]);
        expect(result.preCheckErrors).toHaveLength(2);
        expect(result.preCheckErrors.map(e => e.id)).toEqual(['a', 'b']);
    });
});
