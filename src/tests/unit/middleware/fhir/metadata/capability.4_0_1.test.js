'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('moment-timezone', () => {
    const mockMoment = {
        tz: jestObj.fn().mockReturnThis(),
        format: jestObj.fn().mockReturnValue('2024-06-15T14:30:00-05:00')
    };
    return jestObj.fn(() => mockMoment);
});

jestObj.mock('../../../../../middleware/fhir/utils/schema.utils', () => ({
    resolveSchema: jestObj.fn()
}));

const { makeStatement, securityStatement } = require('../../../../../middleware/fhir/metadata/capability.4_0_1');
const { resolveSchema } = require('../../../../../middleware/fhir/utils/schema.utils');

describe('capability.4_0_1', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
        // Mock resolveSchema to return a constructor that stores properties
        resolveSchema.mockReturnValue(function (props) {
            Object.assign(this, props);
        });
    });

    describe('makeStatement', () => {
        test('creates a CapabilityStatement with active status', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.status).toBe('active');
        });

        test('creates a CapabilityStatement with formatted date', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.date).toBe('2024-06-15T14:30:00-05:00');
        });

        test('sets publisher to Not provided', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.publisher).toBe('Not provided');
        });

        test('sets kind to instance', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.kind).toBe('instance');
        });

        test('sets software name to FHIR Server', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.software.name).toBe('FHIR Server');
        });

        test('sets software version to 1.4.0', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.software.version).toBe('1.4.0');
        });

        test('sets implementation description for R4', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.implementation).toEqual({
                description: 'FHIR Test Server (R4)'
            });
        });

        test('sets fhirVersion to 4.0.1', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.fhirVersion).toBe('4.0.1');
        });

        test('sets acceptUnknown to extensions', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.acceptUnknown).toBe('extensions');
        });

        test('sets format to fhir+json', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.format).toEqual(['application/fhir+json']);
        });

        test('puts resources in rest array', () => {
            const resources = { mode: 'server', resource: [{ type: 'Patient' }] };
            const result = makeStatement(resources);

            expect(result.rest).toEqual([resources]);
        });

        test('calls resolveSchema with 4_0_1 and capabilitystatement', () => {
            const resources = { mode: 'server', resource: [] };
            makeStatement(resources);

            expect(resolveSchema).toHaveBeenCalledWith('4_0_1', 'capabilitystatement');
        });
    });

    describe('securityStatement', () => {
        test('returns object with cors set to true', () => {
            const urls = [{ url: 'authorize', valueUri: 'https://example.com/auth' }];
            const result = securityStatement(urls);

            expect(result.cors).toBe(true);
        });

        test('returns SMART-on-FHIR service coding', () => {
            const urls = [];
            const result = securityStatement(urls);

            expect(result.service).toHaveLength(1);
            expect(result.service[0].coding[0].system).toBe('http://hl7.org/fhir/restful-security-service');
            expect(result.service[0].coding[0].code).toBe('SMART-on-FHIR');
        });

        test('includes service text about SMART-on-FHIR', () => {
            const urls = [];
            const result = securityStatement(urls);

            expect(result.service[0].text).toContain('SMART-on-FHIR');
        });

        test('includes extension with oauth-uris url', () => {
            const urls = [{ url: 'authorize', valueUri: 'https://example.com/auth' }];
            const result = securityStatement(urls);

            expect(result.extension).toHaveLength(1);
            expect(result.extension[0].url).toBe(
                'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
            );
        });

        test('passes security URLs as nested extension', () => {
            const urls = [
                { url: 'authorize', valueUri: 'https://example.com/auth' },
                { url: 'token', valueUri: 'https://example.com/token' }
            ];
            const result = securityStatement(urls);

            expect(result.extension[0].extension).toBe(urls);
        });

        test('returns correct structure with empty URLs', () => {
            const result = securityStatement([]);

            expect(result.cors).toBe(true);
            expect(result.extension[0].extension).toEqual([]);
        });
    });
});
