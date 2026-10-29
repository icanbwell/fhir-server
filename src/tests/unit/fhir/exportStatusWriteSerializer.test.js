'use strict';

const { describe, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const BaseSerializer = require('../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');
const { FhirResourceWriteSerializer } = require('../../../fhir/fhirResourceWriteSerializer');
const { FhirResourceWriteNormalizeSerializer } = require('../../../fhir/fhirResourceWriteNormalizeSerializer');

BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });

const storedExportStatus = (overrides = {}) => ({
    id: 'export-1',
    resourceType: 'ExportStatus',
    meta: {
        versionId: '1',
        source: 'https://example.com/source',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/access', code: 'client' }
        ]
    },
    extension: [{ id: '_type', url: 'https://icanbwell.com/codes/_type', valueString: 'Patient' }],
    status: 'completed',
    request: 'https://fhir.example.com/4_0_0/$export?_type=Patient',
    requiresAccessToken: true,
    scope: 'user/*.read access/*.*',
    user: 'user-1',
    transactionTime: '2026-10-28T00:00:00.000Z',
    output: [{ type: 'Patient', url: 's3://bucket/Patient.ndjson' }],
    errors: [{ type: 'Observation', url: 's3://bucket/OperationOutcome.ndjson' }],
    _uuid: 'uuid-1',
    _access: { client: 1 },
    _sourceAssigningAuthority: 'client',
    _sourceId: 'export-1',
    ...overrides
});

describe('ExportStatus write serializers', () => {
    test.each([
        ['all fields', {}],
        ['empty output and errors', { output: [], errors: [], status: 'accepted' }],
        ['no access token flag', { requiresAccessToken: undefined, user: undefined }]
    ])('write serializer keeps a stored document intact for %s', (_name, overrides) => {
        const stored = JSON.parse(JSON.stringify(storedExportStatus(overrides)));

        const actual = FhirResourceWriteSerializer.serialize({ obj: deepcopy(stored) });

        expect(actual).toStrictEqual({ ...stored, output: stored.output, errors: stored.errors });
    });

    test('write serializer keeps the request url and internal fields', () => {
        const actual = FhirResourceWriteSerializer.serialize({ obj: storedExportStatus() });

        expect(actual.request).toStrictEqual('https://fhir.example.com/4_0_0/$export?_type=Patient');
        expect(actual._uuid).toStrictEqual('uuid-1');
        expect(actual._access).toStrictEqual({ client: 1 });
        expect(actual._sourceAssigningAuthority).toStrictEqual('client');
        expect(actual._sourceId).toStrictEqual('export-1');
    });

    test('write serializer drops fields that are not persisted', () => {
        const actual = FhirResourceWriteSerializer.serialize({
            obj: { ...storedExportStatus(), requestUrl: 'stale', unknownField: 1 }
        });

        expect(actual.requestUrl).toBeUndefined();
        expect(actual.unknownField).toBeUndefined();
    });

    test('missing output and errors are stored as empty arrays like a freshly created export', () => {
        const actual = FhirResourceWriteSerializer.serialize({
            obj: storedExportStatus({ output: undefined, errors: undefined })
        });

        expect(actual.output).toStrictEqual([]);
        expect(actual.errors).toStrictEqual([]);
    });

    test('normalize serializer hides internal fields and keeps the public ones', () => {
        const actual = FhirResourceWriteNormalizeSerializer.serialize({ obj: storedExportStatus() });

        expect(actual).toStrictEqual({
            id: 'export-1',
            resourceType: 'ExportStatus',
            meta: {
                versionId: '1',
                source: 'https://example.com/source',
                security: [
                    { system: 'https://www.icanbwell.com/owner', code: 'client' },
                    { system: 'https://www.icanbwell.com/access', code: 'client' }
                ]
            },
            extension: [{ id: '_type', url: 'https://icanbwell.com/codes/_type', valueString: 'Patient' }],
            status: 'completed',
            request: 'https://fhir.example.com/4_0_0/$export?_type=Patient',
            requiresAccessToken: true,
            scope: 'user/*.read access/*.*',
            user: 'user-1',
            transactionTime: '2026-10-28T00:00:00.000Z',
            output: [{ type: 'Patient', url: 's3://bucket/Patient.ndjson' }],
            errors: [{ type: 'Observation', url: 's3://bucket/OperationOutcome.ndjson' }]
        });
    });

    test('normalize serializer keeps empty output and errors arrays', () => {
        const actual = FhirResourceWriteNormalizeSerializer.serialize({
            obj: storedExportStatus({ output: [], errors: [] })
        });

        expect(actual.output).toStrictEqual([]);
        expect(actual.errors).toStrictEqual([]);
    });
});
