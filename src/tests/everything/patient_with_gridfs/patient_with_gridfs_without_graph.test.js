const env = require('var')
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
const patientPersonData = require('./fixtures/patient/patient_person_data.json');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GridFS everything tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Data retrieval in everything using gridfs works', () => {
        test('data returned and _file_id present in database', async () => {
            const DISABLE_GRAPH_IN_EVERYTHING_OP = env.DISABLE_GRAPH_IN_EVERYTHING_OP;
            const ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP;

            env.DISABLE_GRAPH_IN_EVERYTHING_OP = '1';
            env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = '1';

            const GRIDFS_RESOURCES = process.env.GRIDFS_RESOURCES;
            process.env.GRIDFS_RESOURCES = 'Patient';

            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/patient/$merge')
                .send(patientPersonData)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Patient/1/$everything')
                .set(getHeaders())
                .expect(200);

            expect(resp._body.entry[0].resource.photo[0]._file_id).toBeUndefined();

            expect(resp._body.entry[0].resource.photo[0].data).toBeDefined();

            expect(resp._body.entry[0].resource.photo[0].data).toEqual(patientPersonData[0].photo[0].data);

            const base_version = '4_0_0';
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
                .find({ id: resp._body.entry[0].id }).toArray();

            expect(patient.length).toEqual(1);

            expect(patient[0].photo[0].data).toBeUndefined();

            expect(patient[0].photo[0]._file_id).toBeDefined();

            process.env.GRIDFS_RESOURCES = GRIDFS_RESOURCES;

            env.DISABLE_GRAPH_IN_EVERYTHING_OP = DISABLE_GRAPH_IN_EVERYTHING_OP;
            env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP;
        });
    });
});
