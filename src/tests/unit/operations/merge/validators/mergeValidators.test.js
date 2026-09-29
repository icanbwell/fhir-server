/**
 * Unit tests for BundleResourceValidator and ParametersResourceValidator
 * Focus: input unwrapping, null safety, security-relevant edge cases
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');

const { BundleResourceValidator } = require('../../../../../operations/merge/validators/bundleResourceValidator');
const { ParametersResourceValidator } = require('../../../../../operations/merge/validators/parameterResourceValidator');

describe('BundleResourceValidator', () => {
    let validator;

    beforeEach(() => {
        validator = new BundleResourceValidator();
    });

    describe('Bundle unwrapping', () => {
        test('unwraps Bundle entries into an array of resources', async () => {
            const bundle = {
                resourceType: 'Bundle',
                entry: [
                    { resource: { resourceType: 'Patient', id: 'p1' } },
                    { resource: { resourceType: 'Observation', id: 'o1' } }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: bundle,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(2);
            expect(result.validatedObjects[0]).toEqual({ resourceType: 'Patient', id: 'p1' });
            expect(result.validatedObjects[1]).toEqual({ resourceType: 'Observation', id: 'o1' });
            expect(result.preCheckErrors).toEqual([]);
            expect(result.wasAList).toBe(false);
        });

        test('returns empty array for Bundle with empty entry array', async () => {
            const bundle = {
                resourceType: 'Bundle',
                entry: []
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: bundle,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
        });

        test('returns empty array for Bundle with no entry property', async () => {
            const bundle = {
                resourceType: 'Bundle'
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: bundle,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
        });
    });

    describe('passthrough behavior for non-Bundle input', () => {
        test('passes through an array of resources unchanged', async () => {
            const resources = [
                { resourceType: 'Patient', id: 'p1' },
                { resourceType: 'Observation', id: 'o1' }
            ];

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toBe(resources);
            expect(result.wasAList).toBe(false);
        });

        test('passes through a single non-Bundle resource unchanged', async () => {
            const resource = { resourceType: 'Patient', id: 'p1' };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: resource,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toBe(resource);
        });
    });

    describe('BUG: null/undefined incomingResources returns non-array validatedObjects', () => {
        test('returns null validatedObjects when incomingResources is null', async () => {
            const result = await validator.validate({
                requestInfo: {},
                incomingResources: null,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // BUG: returns { validatedObjects: null } because the condition
            // `incomingResources && ...` fails and null passes through.
            // Downstream code expecting an array will crash.
            expect(result.validatedObjects).toBeNull();
        });

        test('returns undefined validatedObjects when incomingResources is undefined', async () => {
            const result = await validator.validate({
                requestInfo: {},
                incomingResources: undefined,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // BUG: same issue as null — undefined passes through.
            expect(result.validatedObjects).toBeUndefined();
        });
    });

    describe('BUG: entries without resource property produce undefined in validatedObjects', () => {
        test('maps entry without resource property to undefined', async () => {
            const bundle = {
                resourceType: 'Bundle',
                entry: [
                    { resource: { resourceType: 'Patient', id: 'p1' } },
                    { request: { method: 'DELETE', url: 'Patient/p2' } }, // no resource
                    { resource: { resourceType: 'Observation', id: 'o1' } }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: bundle,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // BUG: entry without resource maps to undefined via `e && e.resource`
            expect(result.validatedObjects).toHaveLength(3);
            expect(result.validatedObjects[0]).toEqual({ resourceType: 'Patient', id: 'p1' });
            expect(result.validatedObjects[1]).toBeUndefined();
            expect(result.validatedObjects[2]).toEqual({ resourceType: 'Observation', id: 'o1' });
        });

        test('maps null entry to null via short-circuit', async () => {
            const bundle = {
                resourceType: 'Bundle',
                entry: [
                    null,
                    { resource: { resourceType: 'Patient', id: 'p1' } }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: bundle,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // `e && e.resource` short-circuits to null when e is null
            expect(result.validatedObjects[0]).toBeNull();
            expect(result.validatedObjects[1]).toEqual({ resourceType: 'Patient', id: 'p1' });
        });
    });

    describe('BUG: wasAList is always false even for multi-resource Bundles', () => {
        test('wasAList is false even when Bundle contains multiple resources', async () => {
            const bundle = {
                resourceType: 'Bundle',
                entry: [
                    { resource: { resourceType: 'Patient', id: 'p1' } },
                    { resource: { resourceType: 'Patient', id: 'p2' } },
                    { resource: { resourceType: 'Patient', id: 'p3' } }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: bundle,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // BUG: wasAList is hardcoded to false regardless of input shape.
            // A Bundle with multiple resources IS effectively a list.
            expect(result.wasAList).toBe(false);
            expect(result.validatedObjects).toHaveLength(3);
        });
    });

    describe('SECURITY: no requestInfo validation performed', () => {
        test('does not inspect requestInfo — passes resources through regardless', async () => {
            const bundle = {
                resourceType: 'Bundle',
                entry: [
                    { resource: { resourceType: 'AuditEvent', id: 'ae1' } },
                    { resource: { resourceType: 'ExportStatus', id: 'es1' } }
                ]
            };

            // requestInfo with no scopes/permissions
            const result = await validator.validate({
                requestInfo: { scope: '', user: '' },
                incomingResources: bundle,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // SECURITY: Admin-only resource types pass through without any permission check.
            // If downstream code assumes this validator performed access control, it's a bypass.
            expect(result.validatedObjects).toHaveLength(2);
            expect(result.validatedObjects[0].resourceType).toBe('AuditEvent');
            expect(result.validatedObjects[1].resourceType).toBe('ExportStatus');
            expect(result.preCheckErrors).toEqual([]);
        });
    });
});

describe('ParametersResourceValidator', () => {
    let validator;

    beforeEach(() => {
        validator = new ParametersResourceValidator();
    });

    describe('Parameters resource unwrapping', () => {
        test('extracts resources from Parameters.parameter[].resource', async () => {
            const parameters = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'resource', resource: { resourceType: 'Patient', id: 'p1' } },
                    { name: 'resource', resource: { resourceType: 'Observation', id: 'o1' } }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: parameters,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(2);
            expect(result.validatedObjects[0]).toEqual({ resourceType: 'Patient', id: 'p1' });
            expect(result.validatedObjects[1]).toEqual({ resourceType: 'Observation', id: 'o1' });
            expect(result.wasAList).toBe(true);
        });

        test('filters out parameters without resource property', async () => {
            const parameters = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'resource', resource: { resourceType: 'Patient', id: 'p1' } },
                    { name: 'mode', valueString: 'merge' } // no resource
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: parameters,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(1);
            expect(result.validatedObjects[0].id).toBe('p1');
        });
    });

    describe('error handling for empty Parameters', () => {
        test('returns error when Parameters has no parameter array', async () => {
            const parameters = {
                resourceType: 'Parameters',
                parameter: []
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: parameters,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.wasAList).toBe(true);
        });

        test('returns error when Parameters has no parameter property', async () => {
            const parameters = {
                resourceType: 'Parameters'
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: parameters,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
            expect(result.preCheckErrors).toHaveLength(1);
        });

        test('returns error when no parameters have a resource property', async () => {
            const parameters = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'mode', valueString: 'merge' },
                    { name: 'flag', valueBoolean: true }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: parameters,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
            expect(result.preCheckErrors).toHaveLength(1);
        });
    });

    describe('nested Parameters resource filtering', () => {
        test('filters out nested Parameters resources and reports errors', async () => {
            const parameters = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'resource', resource: { resourceType: 'Patient', id: 'p1' } },
                    { name: 'resource', resource: { resourceType: 'Parameters', id: 'nested1' } },
                    { name: 'resource', resource: { resourceType: 'Observation', id: 'o1' } }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: parameters,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // Valid resources pass through, nested Parameters is filtered out
            expect(result.validatedObjects).toHaveLength(2);
            expect(result.validatedObjects[0].resourceType).toBe('Patient');
            expect(result.validatedObjects[1].resourceType).toBe('Observation');

            // Error reported for the nested Parameters resource
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.preCheckErrors[0].id).toBe('nested1');
            expect(result.preCheckErrors[0].resourceType).toBe('Parameters');
            expect(result.preCheckErrors[0].created).toBe(false);
            expect(result.preCheckErrors[0].updated).toBe(false);
        });

        test('BUG: partial processing continues despite nested Parameters error', async () => {
            // SECURITY: The validator does not reject the entire request when
            // a nested Parameters resource is found. It filters it out and
            // continues processing remaining resources. This partial processing
            // of a malformed request is a security concern.
            const parameters = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'resource', resource: { resourceType: 'Parameters', id: 'malicious1' } },
                    { name: 'resource', resource: { resourceType: 'Patient', id: 'legit1' } }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: parameters,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // BUG: Despite the error, valid resources are still processed
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.validatedObjects).toHaveLength(1);
            expect(result.validatedObjects[0].id).toBe('legit1');
        });
    });

    describe('SECURITY: no resourceType validation on inner resources', () => {
        test('allows admin-only resource types through without validation', async () => {
            // SECURITY: The validator only filters nested Parameters but does NOT
            // validate the resourceType of inner resources. An attacker can wrap
            // admin-only resources (AuditEvent, ExportStatus) inside Parameters.
            const parameters = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'resource', resource: { resourceType: 'AuditEvent', id: 'ae1' } },
                    { name: 'resource', resource: { resourceType: 'ExportStatus', id: 'es1' } },
                    { name: 'resource', resource: { resourceType: 'StructureDefinition', id: 'sd1' } }
                ]
            };

            const result = await validator.validate({
                requestInfo: { scope: 'patient/*.read' },
                incomingResources: parameters,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // All admin-only resources pass through without any type or scope check
            expect(result.validatedObjects).toHaveLength(3);
            expect(result.validatedObjects[0].resourceType).toBe('AuditEvent');
            expect(result.validatedObjects[1].resourceType).toBe('ExportStatus');
            expect(result.validatedObjects[2].resourceType).toBe('StructureDefinition');
            expect(result.preCheckErrors).toEqual([]);
        });
    });

    describe('non-Parameters, non-array input passthrough', () => {
        test('passes through a single non-Parameters resource with wasAList=false', async () => {
            const resource = { resourceType: 'Observation', id: 'o1' };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: resource,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // BUG: validatedObjects is a single object, not an array,
            // which is inconsistent with the declared return type.
            expect(result.validatedObjects).toBe(resource);
            expect(result.wasAList).toBe(false);
            expect(Array.isArray(result.validatedObjects)).toBe(false);
        });

        test('correctly identifies an array input as wasAList=true', async () => {
            const resources = [
                { resourceType: 'Patient', id: 'p1' },
                { resourceType: 'Patient', id: 'p2' }
            ];

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.wasAList).toBe(true);
            expect(result.validatedObjects).toHaveLength(2);
        });
    });

    describe('array input with mixed resource types', () => {
        test('filters null/undefined entries from array via optional chaining', async () => {
            const resources = [
                { resourceType: 'Patient', id: 'p1' },
                null,
                undefined,
                { resourceType: 'Observation', id: 'o1' }
            ];

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // The forEach uses `p?.resourceType` so null/undefined entries
            // hit the `else if (p)` branch which is false, so they are dropped
            expect(result.validatedObjects).toHaveLength(2);
            expect(result.validatedObjects[0].id).toBe('p1');
            expect(result.validatedObjects[1].id).toBe('o1');
            expect(result.preCheckErrors).toEqual([]);
        });

        test('filters multiple nested Parameters from an array', async () => {
            const resources = [
                { resourceType: 'Parameters', id: 'bad1' },
                { resourceType: 'Patient', id: 'p1' },
                { resourceType: 'Parameters', id: 'bad2' }
            ];

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(1);
            expect(result.validatedObjects[0].id).toBe('p1');
            expect(result.preCheckErrors).toHaveLength(2);
            expect(result.preCheckErrors[0].id).toBe('bad1');
            expect(result.preCheckErrors[1].id).toBe('bad2');
        });
    });

    describe('null/undefined incomingResources', () => {
        test('returns null validatedObjects when incomingResources is null', async () => {
            const result = await validator.validate({
                requestInfo: {},
                incomingResources: null,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // null is not a Parameters resource and not an array,
            // so it falls through to the return with wasAList = false
            expect(result.validatedObjects).toBeNull();
            expect(result.wasAList).toBe(false);
        });

        test('returns undefined validatedObjects when incomingResources is undefined', async () => {
            const result = await validator.validate({
                requestInfo: {},
                incomingResources: undefined,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toBeUndefined();
            expect(result.wasAList).toBe(false);
        });
    });
});
