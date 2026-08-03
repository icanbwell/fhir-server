'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../middleware/fhir/metadata/metadata.interactions', () => {
    return jestObj.fn(() => [{ code: 'read' }, { code: 'search-type' }]);
});

jestObj.mock('../../../../../middleware/fhir/metadata/capability.template', () => ({
    resource: jestObj.fn((version, key) => ({ type: key, interaction: [] }))
}));

jestObj.mock('../../../../../middleware/fhir/utils/error.utils', () => ({
    internal: jestObj.fn((msg) => new Error(msg))
}));

const { generateCapabilityStatement } = require('../../../../../middleware/fhir/metadata/metadata.service');

describe('metadata.service', () => {
    const mockMakeStatement = jestObj.fn((serverStatement) => ({
        resourceType: 'CapabilityStatement',
        rest: [serverStatement]
    }));
    const mockSecurityStatement = jestObj.fn((security) => ({ cors: true }));
    const mockStatementGenerator = jestObj.fn(() => ({
        makeStatement: mockMakeStatement,
        securityStatement: mockSecurityStatement
    }));

    test('generates capability statement with profiles', async () => {
        const profiles = {
            Patient: { versions: ['4_0_0'], serviceModule: {}, operation: [] }
        };

        const result = await generateCapabilityStatement({
            fhirVersion: '4_0_0',
            profiles,
            security: { cors: true },
            statementGenerator: mockStatementGenerator
        });

        expect(result.resourceType).toBe('CapabilityStatement');
        expect(mockMakeStatement).toHaveBeenCalled();
        const serverStmt = mockMakeStatement.mock.calls[0][0];
        expect(serverStmt.resource).toHaveLength(1);
        expect(serverStmt.resource[0].type).toBe('Patient');
    });

    test('adds interactions to each resource', async () => {
        const profiles = {
            Observation: { versions: ['4_0_0'], serviceModule: {}, operation: [] }
        };

        await generateCapabilityStatement({
            fhirVersion: '4_0_0',
            profiles,
            statementGenerator: mockStatementGenerator
        });

        const serverStmt = mockMakeStatement.mock.calls[mockMakeStatement.mock.calls.length - 1][0];
        expect(serverStmt.resource[0].interaction).toEqual([
            { code: 'read' }, { code: 'search-type' }
        ]);
    });

    test('filters profiles by version', async () => {
        const profiles = {
            Patient: { versions: ['4_0_0'], serviceModule: {}, operation: [] },
            OldResource: { versions: ['3_0_1'], serviceModule: {}, operation: [] }
        };

        await generateCapabilityStatement({
            fhirVersion: '4_0_0',
            profiles,
            statementGenerator: mockStatementGenerator
        });

        const serverStmt = mockMakeStatement.mock.calls[mockMakeStatement.mock.calls.length - 1][0];
        expect(serverStmt.resource).toHaveLength(1);
        expect(serverStmt.resource[0].type).toBe('Patient');
    });

    test('includes operations from profiles', async () => {
        const profiles = {
            Patient: {
                versions: ['4_0_0'],
                serviceModule: {},
                operation: [
                    { name: 'everything', reference: 'http://hl7.org/fhir/patient-everything' }
                ]
            }
        };

        await generateCapabilityStatement({
            fhirVersion: '4_0_0',
            profiles,
            statementGenerator: mockStatementGenerator
        });

        const serverStmt = mockMakeStatement.mock.calls[mockMakeStatement.mock.calls.length - 1][0];
        expect(serverStmt.operation).toHaveLength(1);
        expect(serverStmt.operation[0].name).toBe('everything');
    });

    test('adds security statement when security provided', async () => {
        const profiles = {
            Patient: { versions: ['4_0_0'], serviceModule: {}, operation: [] }
        };

        await generateCapabilityStatement({
            fhirVersion: '4_0_0',
            profiles,
            security: { cors: true },
            statementGenerator: mockStatementGenerator
        });

        const serverStmt = mockMakeStatement.mock.calls[mockMakeStatement.mock.calls.length - 1][0];
        expect(serverStmt.security).toEqual({ cors: true });
    });

    test('rejects when makeStatement is missing', async () => {
        const badGenerator = () => ({ makeStatement: null, securityStatement: null });
        const profiles = { Patient: { versions: ['4_0_0'], operation: [] } };

        await expect(generateCapabilityStatement({
            fhirVersion: '4_0_0',
            profiles,
            statementGenerator: badGenerator
        })).rejects.toThrow('Unable to generate metadata');
    });
});
