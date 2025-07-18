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
const { FixReferenceIdHapiRunner } = require('../../../../admin/runners/fixReferenceIdHapiRunner');
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
            // will not be able to find patient due to wrong uuid of person
            expect(patientReferencesBeforeRun).toEqual(["person.27153f78-54c7-5029-889b-1026a9580ebf"]);

            // run admin runner
            const collections = ['all'];
            const batchSize = 1;

            container.register('fixReferenceIdHapiRunner', (c) => new FixReferenceIdHapiRunner(
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
             * @type {FixReferenceIdHapiRunner}
             */
            const fixReferenceIdHapiRunner = container.fixReferenceIdHapiRunner;
            assertTypeEquals(fixReferenceIdHapiRunner, FixReferenceIdHapiRunner);
            await fixReferenceIdHapiRunner.processAsync();

            const patientReferencesAfterRun = await personToPatientIdsExpander.getPatientIdsFromPersonAsync({
                personIds: ['2'],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager: databaseQueryFactory.createQuery({
                    resourceType: 'Person', base_version: '4_0_0'
                }),
                level: 1
            });

            // will find it correctly after fix
            const patientUuid = expectedPatient1AfterRun.identifier.find((v) => v.system === IdentifierSystem.uuid);
            expect(patientReferencesAfterRun).toEqual([
                "person.27153f78-54c7-5029-889b-1026a9580ebf",
                "person.e8c1b4a5-f998-5793-8fbe-f9fea31c00ab",
                "42f5ad1f-9711-50ed-9406-4b90bcb4473d"
            ]);
        });
    });
});
