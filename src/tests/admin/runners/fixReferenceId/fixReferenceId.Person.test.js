// test file
const person1Resource = require('./fixtures/Person/person.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');

// expected
const expectedPersonBeforeRun = require('./fixtures/expected/expected_person_before_run.json');
const expectedPatient1BeforeRun = require('./fixtures/expected/expected_patient1_before_run.json');
const expectedPatient2BeforeRun = require('./fixtures/expected/expected_patient2_before_run.json');

const expectedPersonAfterRun = require('./fixtures/expected/expected_person.json');
const expectedPatient1AfterRun = require('./fixtures/expected/expected_patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const {AdminLogger} = require('../../../../admin/adminLogger');
const {FixReferenceIdRunner} = require('../../../../admin/runners/fixReferenceIdRunner');
const {assertTypeEquals} = require('../../../../utils/assertType');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person fixReferenceId Tests', () => {
        test('fixReferenceId works for patient', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get(`/4_0_0/Person/${expectedPersonBeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const personBeforeRun = resp.body;
            delete personBeforeRun.meta.lastUpdated;
            expect(personBeforeRun).toEqual(expectedPersonBeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1BeforeRun = resp.body;
            delete patient1BeforeRun.meta.lastUpdated;
            expect(patient1BeforeRun).toEqual(expectedPatient1BeforeRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient2BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient2BeforeRun = resp.body;
            delete patient2BeforeRun.meta.lastUpdated;
            expect(patient2BeforeRun).toEqual(expectedPatient2BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('fixReferenceIdRunner', (c) => new FixReferenceIdRunner(
                    {
                        mongoCollectionManager: c.mongoCollectionManager,
                        collections,
                        batchSize,
                        useAuditDatabase: false,
                        adminLogger: new AdminLogger(),
                        proaCollections: ['Patient_4_0_0'],
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger
                    }
                )
            );

            /**
             * @type {FixReferenceIdRunner}
             */
            const fixReferenceIdRunner = container.fixReferenceIdRunner;
            assertTypeEquals(fixReferenceIdRunner, FixReferenceIdRunner);
            await fixReferenceIdRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPersonAfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const personAfterRun = resp.body;
            delete personAfterRun.meta.lastUpdated;
            expect(personAfterRun).toEqual(expectedPersonAfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient1AfterRun = resp.body;
            delete patient1AfterRun.meta.lastUpdated;
            expect(patient1AfterRun).toEqual(expectedPatient1AfterRun);

            resp = await request
                .get(`/4_0_0/Patient/${expectedPatient2BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const patient2AfterRun = resp.body;
            delete patient2AfterRun.meta.lastUpdated;
            expect(patient2AfterRun).toEqual(expectedPatient2BeforeRun);

            await request
                .get(`/4_0_0/Patient/${expectedPatient1BeforeRun.id}`)
                .set(getHeaders())
                .expect(404);
        });
    });
});
