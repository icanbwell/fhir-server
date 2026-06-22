const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getToken } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const validParametersBody = {
    resourceType: 'Parameters',
    parameter: [
        {
            name: 'inputFormat',
            valueString: 'application/fhir+ndjson'
        },
        {
            name: 'input',
            part: [
                { name: 'type', valueString: 'Patient' },
                { name: 'url', valueUri: 's3://allowed-bucket/run-001/Patient.ndjson' }
            ]
        }
    ]
};

const multiFileBody = {
    resourceType: 'Parameters',
    parameter: [
        {
            name: 'inputFormat',
            valueString: 'application/fhir+ndjson'
        },
        {
            name: 'input',
            part: [
                { name: 'type', valueString: 'Patient' },
                { name: 'url', valueUri: 's3://allowed-bucket/run-001/Patient.ndjson' }
            ]
        },
        {
            name: 'input',
            part: [
                { name: 'type', valueString: 'Condition' },
                { name: 'url', valueUri: 's3://allowed-bucket/run-001/Condition.ndjson' }
            ]
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

    test('input without type part is accepted', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' },
                {
                    name: 'input',
                    part: [
                        { name: 'url', valueUri: 's3://allowed-bucket/run-001/data.ndjson' }
                    ]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(202);
    });

    test('missing body returns 400', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/$import')
            .send({})
            .set(getHeaders())
            .expect(400);

        expect(resp.body.resourceType).toBe('OperationOutcome');
    });

    test('wrong resourceType returns 400', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send({ resourceType: 'Bundle', parameter: [] })
            .set(getHeaders())
            .expect(400);
    });

    test('missing inputFormat returns 400', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                {
                    name: 'input',
                    part: [
                        { name: 'url', valueUri: 's3://allowed-bucket/file.ndjson' }
                    ]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('wrong inputFormat returns 400', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'text/csv' },
                {
                    name: 'input',
                    part: [
                        { name: 'url', valueUri: 's3://allowed-bucket/file.ndjson' }
                    ]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('no input parameters returns 400', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('too many input files returns 400', async () => {
        process.env.BULK_IMPORT_MAX_FILES_PER_REQUEST = '2';
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' },
                {
                    name: 'input',
                    part: [{ name: 'url', valueUri: 's3://allowed-bucket/file1.ndjson' }]
                },
                {
                    name: 'input',
                    part: [{ name: 'url', valueUri: 's3://allowed-bucket/file2.ndjson' }]
                },
                {
                    name: 'input',
                    part: [{ name: 'url', valueUri: 's3://allowed-bucket/file3.ndjson' }]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('input missing url part returns 400', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' },
                {
                    name: 'input',
                    part: [{ name: 'type', valueString: 'Patient' }]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('input without part array returns 400', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' },
                { name: 'input', valueString: 's3://allowed-bucket/file.ndjson' }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('invalid S3 URI returns 400', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' },
                {
                    name: 'input',
                    part: [
                        { name: 'url', valueUri: 'https://example.com/file.ndjson' }
                    ]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('S3 URI with no key returns 400', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' },
                {
                    name: 'input',
                    part: [
                        { name: 'url', valueUri: 's3://allowed-bucket' }
                    ]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('bucket not in allow-list returns 400', async () => {
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' },
                {
                    name: 'input',
                    part: [
                        { name: 'url', valueUri: 's3://unauthorized-bucket/file.ndjson' }
                    ]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(400);
    });

    test('any bucket accepted when allow-list is empty', async () => {
        process.env.BULK_IMPORT_ALLOWED_S3_BUCKETS = '';
        const request = await createTestRequest();

        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'inputFormat', valueString: 'application/fhir+ndjson' },
                {
                    name: 'input',
                    part: [
                        { name: 'url', valueUri: 's3://any-bucket/file.ndjson' }
                    ]
                }
            ]
        };

        await request
            .post('/4_0_0/$import')
            .send(body)
            .set(getHeaders())
            .expect(202);
    });

    test('patient-scoped token returns 403', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders('patient/Patient.read user/*.write access/*.*'))
            .expect(403);
    });

    test('feature gate off returns 404', async () => {
        process.env.ENABLE_BULK_IMPORT = '0';
        const request = await createTestRequest();

        await request
            .post('/4_0_0/$import')
            .send(validParametersBody)
            .set(getHeaders())
            .expect(404);
    });
});
