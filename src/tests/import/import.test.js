const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getToken } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const validParametersBody = {
    resourceType: 'Parameters',
    id: 'import-job-001',
    parameter: [
        {
            name: 'input',
            valueUri: 's3://allowed-bucket/run-001/Patient.ndjson'
        }
    ]
};

const multiFileBody = {
    resourceType: 'Parameters',
    id: 'import-job-002',
    parameter: [
        {
            name: 'input',
            valueUri: 's3://allowed-bucket/run-001/Patient.ndjson'
        },
        {
            name: 'input',
            valueUri: 's3://allowed-bucket/run-001/Condition.ndjson'
        }
    ]
};

describe('Import Tests', () => {
    beforeEach(async () => {
        process.env.ENABLE_BULK_IMPORT = '1';
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = 'allowed-bucket,another-bucket';
        await commonBeforeEach();
    });

    afterEach(async () => {
        delete process.env.ENABLE_BULK_IMPORT;
        delete process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS;
        delete process.env.BULK_IMPORT_MAX_FILES_PER_REQUEST;
        await commonAfterEach();
    });

    test('valid Parameters body returns 202 with OperationOutcome', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);

        expect(resp.body.resourceType).toBe('OperationOutcome');
        expect(resp.body.id).toBe('import-job-001');
        expect(resp.body.issue[0].severity).toBe('information');
        expect(resp.body.issue[0].code).toBe('informational');
        expect(resp.body.issue[0].diagnostics).toContain('1 input file(s)');
    });

    test('multiple input files returns count in diagnostics', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/$import')
            .send(multiFileBody)
            .set(getHeaders())
            .expect(202);

        expect(resp.body.issue[0].diagnostics).toContain('2 input file(s)');
    });

    test('missing id returns 400 with error message', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'input', valueUri: 's3://allowed-bucket/run-001/Patient.ndjson' }
            ]
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Parameters.id is required and must be a non-empty string'
                    }
                }
            ]
        });
    });

    test('empty id returns 400 with error message', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            id: '   ',
            parameter: [
                { name: 'input', valueUri: 's3://allowed-bucket/run-001/Patient.ndjson' }
            ]
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Parameters.id is required and must be a non-empty string'
                    }
                }
            ]
        });
    });

    test('missing body returns 400 with error message', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/$import')
            .send({})
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Request body must be a FHIR Parameters resource with a parameter array'
                    }
                }
            ]
        });
    });

    test('wrong resourceType returns 400 with error message', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/$import')
            .send({ resourceType: 'Bundle', parameter: [] })
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Request body must be a FHIR Parameters resource with a parameter array'
                    }
                }
            ]
        });
    });

    test('no input parameters returns 400 with error message', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            id: 'import-no-inputs',
            parameter: []
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'At least one input parameter is required'
                    }
                }
            ]
        });
    });

    test('too many input files returns 400 with error message', async () => {
        process.env.BULK_IMPORT_MAX_FILES_PER_REQUEST = '2';
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            id: 'import-too-many',
            parameter: [
                { name: 'input', valueUri: 's3://allowed-bucket/file1.ndjson' },
                { name: 'input', valueUri: 's3://allowed-bucket/file2.ndjson' },
                { name: 'input', valueUri: 's3://allowed-bucket/file3.ndjson' }
            ]
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Too many input files: 3 exceeds maximum of 2'
                    }
                }
            ]
        });
    });

    test('input without valueUri returns 400 with error message', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            id: 'import-missing-uri',
            parameter: [
                { name: 'input', valueString: 's3://allowed-bucket/file.ndjson' }
            ]
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'input parameter at index 0 must have a valueUri'
                    }
                }
            ]
        });
    });

    test('invalid S3 URI returns 400 with error message', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            id: 'import-bad-uri',
            parameter: [
                { name: 'input', valueUri: 'https://example.com/file.ndjson' }
            ]
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Invalid S3 URI: "https://example.com/file.ndjson". Must match s3://bucket/key'
                    }
                }
            ]
        });
    });

    test('S3 URI with no key returns 400 with error message', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            id: 'import-no-key',
            parameter: [
                { name: 'input', valueUri: 's3://allowed-bucket' }
            ]
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Invalid S3 URI: "s3://allowed-bucket". Must match s3://bucket/key'
                    }
                }
            ]
        });
    });

    test('bucket not in allow-list returns 400 with error message', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            id: 'import-bad-bucket',
            parameter: [
                { name: 'input', valueUri: 's3://unauthorized-bucket/file.ndjson' }
            ]
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'S3 bucket "unauthorized-bucket" is not in the allowed bucket list'
                    }
                }
            ]
        });
    });

    test('empty allow-list rejects all requests (fail-closed)', async () => {
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = '';
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            id: 'import-empty-allowlist',
            parameter: [
                { name: 'input', valueUri: 's3://any-bucket/file.ndjson' }
            ]
        };

        const resp = await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'invalid',
                    details: {
                        text: 'Bulk import S3 bucket allow-list is not configured. Set BULK_IMPORT_ALLOWED_S3_BUCKETS.'
                    }
                }
            ]
        });
    });

    test('malformed BULK_IMPORT_MAX_FILES_PER_REQUEST falls back to default cap', async () => {
        process.env.BULK_IMPORT_MAX_FILES_PER_REQUEST = 'not-a-number';
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(202);
    });

    test('patient-scoped token returns 403 with error message', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders('patient/Patient.read user/*.write access/*.*'))
            .expect(403);

        expect(resp).toHaveResponse({
            resourceType: 'OperationOutcome',
            issue: [
                {
                    severity: 'error',
                    code: 'forbidden',
                    details: {
                        text: 'Bulk import cannot be triggered with patient scopes'
                    },
                    diagnostics: 'Bulk import cannot be triggered with patient scopes'
                }
            ]
        });
    });

    // Feature gate (ENABLE_BULK_IMPORT=0) is not testable here because
    // createTestRequest caches the Express app — routes registered at startup
    // can't be toggled per test. The gate is verified by the router code path.
});
