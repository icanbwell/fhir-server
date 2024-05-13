const patientData = require('./fixtures/patient_with_photo.json');

const fs = require('fs');
const path = require('path');

const query = fs.readFileSync(path.resolve(__dirname, './fixtures/query_patient_with_gridfs.graphql'), 'utf8');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { logError } = require('../../../operations/common/logging');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { createTestContainer } = require('../../createTestContainer');

describe('GraphQL Patient Update Care Team Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Patient with GridFS', () => {
        test('Patient Retrieval', async () => {
            const GRIDFS_RESOURCES = process.env.GRIDFS_RESOURCES;
            process.env.GRIDFS_RESOURCES = 'Patient';

            const base_version = '4_0_0';
            const request = await createTestRequest();
            const graphqlQueryText = query.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patientData)
                .set(getHeaders())
                .expect(200);

            const container = createTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();

            const patientCollection = `Patient_${base_version}`;

            const patient = await fhirDb.collection(patientCollection)
                .find({ id: resp._body.id }, { photo: 1 }).toArray();

            expect(patient.length).toEqual(1);

            expect(patient[0].photo.length).toEqual(1);

            expect(patient[0].photo[0].data).toBeUndefined();

            expect(patient[0].photo[0]._file_id).toBeDefined();

            resp = await request
                .post('/$graphqlv2')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders())
                .expect(200);

            const body = resp.body;
            if (body.errors) {
                logError('', { errors: body.errors });
                expect(body.errors).toBeUndefined();
            }

            const patients = body.data.patient.entry;

            expect(patients[0].resource.photo.length).toEqual(1);

            expect(patients[0].resource.photo[0]._file_id).toBeUndefined();

            expect(patients[0].resource.photo[0].data).toBeDefined();

            expect(patients[0].resource.photo[0].data).toEqual(patientData.photo[0].data);

            process.env.GRIDFS_RESOURCES = GRIDFS_RESOURCES;
        });
    });
});
