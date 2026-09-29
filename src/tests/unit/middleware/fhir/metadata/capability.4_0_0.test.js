const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('moment-timezone', () => {
    const mockMoment = {
        tz: jestObj.fn().mockReturnThis(),
        format: jestObj.fn().mockReturnValue('2024-01-15T10:30:00-05:00')
    };
    return jestObj.fn(() => mockMoment);
});

jestObj.mock('../../../../../middleware/fhir/utils/schema.utils', () => ({
    resolveSchema: jestObj.fn()
}));

const { makeStatement, securityStatement } = require('../../../../../middleware/fhir/metadata/capability.4_0_0');
const { resolveSchema } = require('../../../../../middleware/fhir/utils/schema.utils');

describe('capability.4_0_0', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
        // Mock resolveSchema to return a constructor that stores properties
        resolveSchema.mockReturnValue(function (props) {
            Object.assign(this, props);
        });
    });

    describe('makeStatement', () => {
        test('creates a CapabilityStatement with correct status', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.status).toBe('active');
        });

        test('creates a CapabilityStatement with formatted date', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.date).toBe('2024-01-15T10:30:00-05:00');
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

        test('sets software name and version', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.software).toEqual({
                name: 'FHIR Server',
                version: '1.4.0'
            });
        });

        test('sets implementation description', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.implementation).toEqual({
                description: 'FHIR Test Server (R4)'
            });
        });

        test('sets fhirVersion to 4.0.0', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.fhirVersion).toBe('4.0.0');
        });

        test('sets format to application/fhir+json', () => {
            const resources = { mode: 'server', resource: [] };
            const result = makeStatement(resources);

            expect(result.format).toEqual(['application/fhir+json']);
        });

        test('wraps resources in rest array', () => {
            const resources = { mode: 'server', resource: [{ type: 'Patient' }] };
            const result = makeStatement(resources);

            expect(result.rest).toEqual([resources]);
        });

        test('resolves CapabilityStatement schema for version 4_0_0', () => {
            const resources = { mode: 'server', resource: [] };
            makeStatement(resources);

            expect(resolveSchema).toHaveBeenCalledWith('4_0_0', 'capabilitystatement');
        });
    });

    describe('securityStatement', () => {
        test('returns object with cors set to true', () => {
            const securityUrls = [{ url: 'authorize', valueUri: 'https://auth.example.com/authorize' }];
            const result = securityStatement(securityUrls);

            expect(result.cors).toBe(true);
        });

        test('returns SMART-on-FHIR service coding', () => {
            const securityUrls = [];
            const result = securityStatement(securityUrls);

            expect(result.service).toEqual([{
                coding: [{
                    system: 'http://hl7.org/fhir/restful-security-service',
                    code: 'SMART-on-FHIR'
                }],
                text: 'Custom OAuth2 using SMART-on-FHIR profile (see http://docs.smarthealthit.org)'
            }]);
        });

        test('includes securityUrls in extension', () => {
            const securityUrls = [
                { url: 'authorize', valueUri: 'https://auth.example.com/authorize' },
                { url: 'token', valueUri: 'https://auth.example.com/token' }
            ];
            const result = securityStatement(securityUrls);

            expect(result.extension).toEqual([{
                url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
                extension: securityUrls
            }]);
        });

        test('handles empty securityUrls array', () => {
            const result = securityStatement([]);

            expect(result.extension[0].extension).toEqual([]);
        });
    });
});
