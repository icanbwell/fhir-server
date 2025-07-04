// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');

// expected
const expectedPatient1AfterRun = require('./fixtures/expected/expected_patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { FixReferenceIdRunner } = require('../../../../admin/runners/fixReferenceIdRunner');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { PersonToPatientIdsExpander } = require('../../../../utils/personToPatientIdsExpander');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person FixReferenceId bwellMasterPerson Tests', () => {
        test('Fix client person and bwell master person reference', async () => {

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();

            container.register('personToPatientIdsExpander', c => new PersonToPatientIdsExpander({
                databaseQueryFactory: c.databaseQueryFactory
            }));

            const personToPatientIdsExpander = container.personToPatientIdsExpander;

            const databaseQueryFactory = container.databaseQueryFactory;

            const patientReferencesBeforeRun = await personToPatientIdsExpander.getPatientIdsFromPersonAsync({
                personIds: ['2'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: databaseQueryFactory.createQuery({
                    resourceType: 'Person', base_version: '4_0_0'
                }),
                level: 1
            });
            // will not be able to find because of wrong uuid reference
            expect(patientReferencesBeforeRun).toEqual(["person.27153f78-54c7-5029-889b-1026a9580ebf"]);

            // run admin runner
            const collections = ['all'];
            const batchSize = 1;

            container.register('fixReferenceIdRunner', (c) => new FixReferenceIdRunner(
                {
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    proaCollections: ['Person_4_0_0', 'Patient_4_0_0'],
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    searchParametersManager: c.searchParametersManager
                }
            )
            );

            /**
             * @type {FixReferenceIdRunner}
             */
            const fixReferenceIdRunner = container.fixReferenceIdRunner;
            assertTypeEquals(fixReferenceIdRunner, FixReferenceIdRunner);
            await fixReferenceIdRunner.processAsync();

            const patientReferencesAfterRun = await personToPatientIdsExpander.getPatientIdsFromPersonAsync({
                personIds: ['2'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: databaseQueryFactory.createQuery({
                    resourceType: 'Person', base_version: '4_0_0'
                }),
                level: 1
            });
            expect(patientReferencesAfterRun).toEqual([
                "person.27153f78-54c7-5029-889b-1026a9580ebf",
                "person.96eb1fd2-b2af-5315-9e09-dae5ee44056b",
                "350fccba-0740-57e2-a088-4aba2a9b3aea"
            ]);
        });
    });
});
