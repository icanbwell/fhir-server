'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../utils/uid.util', () => ({
    isUuid: jestObj.fn((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)),
    generateUUIDv5: jestObj.fn((input) => `uuidv5-${input}`),
    generateUUID: jestObj.fn(() => 'generated-uuid-4')
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg); })
}));

jestObj.mock('../../../fhir/classes/4_0_0/resources/resource', () => class Resource {});

const { UuidColumnHandler } = require('../../../preSaveHandlers/handlers/uuidColumnHandler');
const { IdentifierSystem } = require('../../../utils/identifierSystem');
const { isUuid, generateUUIDv5, generateUUID } = require('../../../utils/uid.util');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

describe('UuidColumnHandler', () => {
    let handler;

    beforeEach(() => {
        handler = new UuidColumnHandler();
        jestObj.clearAllMocks();
    });

    describe('preSaveAsync - UUID id', () => {
        test('sets _uuid to id when id is a valid UUID', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient'
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._uuid).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        });

        test('uses isUuid to check the id', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient'
            };
            await handler.preSaveAsync({ resource });
            expect(isUuid).toHaveBeenCalledWith('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        });

        test('does not call generateUUID or generateUUIDv5 when id is UUID', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient'
            };
            await handler.preSaveAsync({ resource });
            expect(generateUUID).not.toHaveBeenCalled();
            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('handles uppercase UUID', async () => {
            const resource = {
                id: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
                resourceType: 'Patient'
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._uuid).toBe('A1B2C3D4-E5F6-7890-ABCD-EF1234567890');
        });
    });

    describe('preSaveAsync - empty/null/undefined id', () => {
        test('generates UUID v4 when id is empty string', async () => {
            const resource = { id: '', resourceType: 'Patient' };
            const result = await handler.preSaveAsync({ resource });
            expect(result._uuid).toBe('generated-uuid-4');
            expect(generateUUID).toHaveBeenCalledTimes(1);
        });

        test('generates UUID v4 when id is null', async () => {
            const resource = { id: null, resourceType: 'Patient' };
            const result = await handler.preSaveAsync({ resource });
            expect(result._uuid).toBe('generated-uuid-4');
            expect(generateUUID).toHaveBeenCalledTimes(1);
        });

        test('generates UUID v4 when id is undefined', async () => {
            const resource = { id: undefined, resourceType: 'Patient' };
            const result = await handler.preSaveAsync({ resource });
            expect(result._uuid).toBe('generated-uuid-4');
            expect(generateUUID).toHaveBeenCalledTimes(1);
        });

        test('generates UUID v4 when id property does not exist', async () => {
            const resource = { resourceType: 'Patient' };
            const result = await handler.preSaveAsync({ resource });
            expect(result._uuid).toBe('generated-uuid-4');
        });
    });

    describe('preSaveAsync - non-UUID id with sourceAssigningAuthority', () => {
        test('generates UUID v5 from id|sourceAssigningAuthority', async () => {
            const resource = {
                id: 'my-patient-id',
                resourceType: 'Patient',
                _sourceAssigningAuthority: 'bwell'
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._uuid).toBe('uuidv5-my-patient-id|bwell');
            expect(generateUUIDv5).toHaveBeenCalledWith('my-patient-id|bwell');
        });

        test('passes correct concatenated string to generateUUIDv5', async () => {
            const resource = {
                id: 'patient-123',
                resourceType: 'Patient',
                _sourceAssigningAuthority: 'hospital-system'
            };
            await handler.preSaveAsync({ resource });
            expect(generateUUIDv5).toHaveBeenCalledWith('patient-123|hospital-system');
        });

        test('throws when sourceAssigningAuthority is null', async () => {
            const resource = {
                id: 'my-patient-id',
                resourceType: 'Patient',
                _sourceAssigningAuthority: null
            };
            await expect(handler.preSaveAsync({ resource }))
                .rejects.toThrow(/sourceAssigningAuthority is null for Patient\/my-patient-id/);
        });

        test('throws when sourceAssigningAuthority is undefined', async () => {
            const resource = {
                id: 'my-patient-id',
                resourceType: 'Patient',
                _sourceAssigningAuthority: undefined
            };
            await expect(handler.preSaveAsync({ resource }))
                .rejects.toThrow(/sourceAssigningAuthority is null/);
        });

        test('throws when sourceAssigningAuthority is empty string (falsy)', async () => {
            const resource = {
                id: 'my-patient-id',
                resourceType: 'Patient',
                _sourceAssigningAuthority: ''
            };
            await expect(handler.preSaveAsync({ resource }))
                .rejects.toThrow(/sourceAssigningAuthority is null/);
        });

        test('error message includes resourceType and id', async () => {
            const resource = {
                id: 'observation-456',
                resourceType: 'Observation',
                _sourceAssigningAuthority: null
            };
            await expect(handler.preSaveAsync({ resource }))
                .rejects.toThrow('sourceAssigningAuthority is null for Observation/observation-456');
        });
    });

    describe('preSaveAsync - identifier filtering', () => {
        test('removes uuid system identifiers from identifier array', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient',
                identifier: [
                    { system: IdentifierSystem.uuid, value: 'old-uuid' },
                    { system: 'http://hospital.org/mrn', value: '12345' }
                ]
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result.identifier).toHaveLength(1);
            expect(result.identifier[0].system).toBe('http://hospital.org/mrn');
        });

        test('removes multiple uuid system identifiers', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient',
                identifier: [
                    { system: IdentifierSystem.uuid, value: 'uuid-1' },
                    { system: IdentifierSystem.uuid, value: 'uuid-2' },
                    { system: 'http://hospital.org/mrn', value: '12345' }
                ]
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result.identifier).toHaveLength(1);
            expect(result.identifier[0].value).toBe('12345');
        });

        test('deletes identifier property when all identifiers are uuid system and resource is plain object', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient',
                identifier: [
                    { system: IdentifierSystem.uuid, value: 'old-uuid' }
                ]
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result.identifier).toBeUndefined();
        });

        test('preserves empty identifier array on Resource instances (does not delete)', async () => {
            const resource = new Resource();
            resource.id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
            resource.resourceType = 'Patient';
            resource.identifier = [{ system: IdentifierSystem.uuid, value: 'x' }];
            const result = await handler.preSaveAsync({ resource });
            expect(result.identifier).toBeDefined();
            expect(result.identifier).toHaveLength(0);
        });

        test('does not modify identifier when no uuid identifiers exist', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient',
                identifier: [
                    { system: 'http://hospital.org/mrn', value: '12345' },
                    { system: 'http://hospital.org/ssn', value: '999-99-9999' }
                ]
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result.identifier).toHaveLength(2);
        });

        test('handles resource without identifier property', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient'
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result.identifier).toBeUndefined();
        });

        test('handles identifier that is null (not array)', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient',
                identifier: null
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result.identifier).toBeNull();
        });

        test('handles identifier that is not an array (string)', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient',
                identifier: 'not-an-array'
            };
            const result = await handler.preSaveAsync({ resource });
            // non-array identifier is not touched
            expect(result.identifier).toBe('not-an-array');
        });

        test('empty identifier array is deleted for plain objects', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient',
                identifier: []
            };
            const result = await handler.preSaveAsync({ resource });
            // Empty array after filter means length 0, and since not Resource instance, it's deleted
            expect(result.identifier).toBeUndefined();
        });
    });

    describe('preSaveAsync - return value', () => {
        test('returns the same resource reference', async () => {
            const resource = {
                id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                resourceType: 'Patient'
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result).toBe(resource);
        });

        test('mutates and returns the resource (not a copy)', async () => {
            const resource = {
                id: 'my-id',
                resourceType: 'Patient',
                _sourceAssigningAuthority: 'bwell'
            };
            const result = await handler.preSaveAsync({ resource });
            expect(result._uuid).toBe('uuidv5-my-id|bwell');
            expect(resource._uuid).toBe('uuidv5-my-id|bwell');
        });
    });
});
