'use strict';

const { describe, test, expect } = require('@jest/globals');
const { BundleResourceValidator } = require('../../../../../operations/merge/validators/bundleResourceValidator');

describe('BundleResourceValidator', () => {
    const validator = new BundleResourceValidator();
    const requestInfo = { user: 'test', scope: 'system/*.*' };

    test('unwraps Bundle entry into array of resources', async () => {
        const bundle = {
            resourceType: 'Bundle',
            entry: [
                { resource: { resourceType: 'Patient', id: '1' } },
                { resource: { resourceType: 'Observation', id: '2' } }
            ]
        };
        const { validatedObjects, preCheckErrors } = await validator.validate({
            requestInfo,
            incomingResources: bundle,
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(validatedObjects).toHaveLength(2);
        expect(validatedObjects[0].resourceType).toBe('Patient');
        expect(validatedObjects[1].resourceType).toBe('Observation');
        expect(preCheckErrors).toEqual([]);
    });

    test('returns empty array for Bundle with no entries', async () => {
        const bundle = { resourceType: 'Bundle', entry: [] };
        const { validatedObjects } = await validator.validate({
            requestInfo,
            incomingResources: bundle,
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(validatedObjects).toEqual([]);
    });

    test('returns empty array for Bundle without entry property', async () => {
        const bundle = { resourceType: 'Bundle' };
        const { validatedObjects } = await validator.validate({
            requestInfo,
            incomingResources: bundle,
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(validatedObjects).toEqual([]);
    });

    test('passes through array input unchanged', async () => {
        const resources = [
            { resourceType: 'Patient', id: '1' },
            { resourceType: 'Observation', id: '2' }
        ];
        const { validatedObjects } = await validator.validate({
            requestInfo,
            incomingResources: resources,
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(validatedObjects).toEqual(resources);
    });

    test('passes through single non-Bundle resource', async () => {
        const resource = { resourceType: 'Patient', id: '1' };
        const { validatedObjects } = await validator.validate({
            requestInfo,
            incomingResources: resource,
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(validatedObjects).toEqual(resource);
    });

    test('handles null entry elements in Bundle', async () => {
        const bundle = {
            resourceType: 'Bundle',
            entry: [
                { resource: { resourceType: 'Patient', id: '1' } },
                null
            ]
        };
        const { validatedObjects } = await validator.validate({
            requestInfo,
            incomingResources: bundle,
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(validatedObjects).toContain(null);
    });

    test('handles entry without resource property', async () => {
        const bundle = {
            resourceType: 'Bundle',
            entry: [
                { resource: { resourceType: 'Patient', id: '1' } },
                { fullUrl: 'urn:uuid:123' }
            ]
        };
        const { validatedObjects } = await validator.validate({
            requestInfo,
            incomingResources: bundle,
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(validatedObjects[1]).toBeUndefined();
    });

    test('always returns wasAList=false', async () => {
        const { wasAList } = await validator.validate({
            requestInfo,
            incomingResources: [{ resourceType: 'Patient' }],
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(wasAList).toBe(false);
    });

    test('always returns empty preCheckErrors', async () => {
        const { preCheckErrors } = await validator.validate({
            requestInfo,
            incomingResources: { resourceType: 'Bundle', entry: [] },
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(preCheckErrors).toEqual([]);
    });

    test('null incomingResources passes through', async () => {
        const { validatedObjects } = await validator.validate({
            requestInfo,
            incomingResources: null,
            base_version: '4_0_0',
            effectiveSmartMerge: false
        });
        expect(validatedObjects).toBeNull();
    });
});
