// test file
const masterPerson1 = require('./fixtures/person/masterPerson1.json');
const masterPerson2 = require('./fixtures/person/masterPerson2.json');
const proaPerson1 = require('./fixtures/person/proaPerson1.json');
const proaPerson2 = require('./fixtures/person/proaPerson2.json');
const clientPerson1 = require('./fixtures/person/clientPerson1.json');
const clientPerson2 = require('./fixtures/person/clientPerson2.json');

const proaPatient = require('./fixtures/patient/proaPatient.json');
const masterPatient = require('./fixtures/patient/masterPatient.json');

// expected
const expectedResponse1 = require('./fixtures/expected/expectedResponse1.json');
const expectedResponse2 = require('./fixtures/expected/expectedResponse2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders,
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { assertTypeEquals } = require('../../../../utils/assertType');
const {
    ProaPatientClientPersonLinkRunner,
} = require('../../../../admin/runners/proaPatientClientPersonLinkRunner');

describe('Proa patient client persons linking tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.proaPatientClientPersonLinkRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Test cases for linking of proa patient & client person', () => {
        test('Proa patient not linked to client person as the master person does not have any master patient linked', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([masterPerson1, proaPerson1, proaPerson2, clientPerson1, proaPatient])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            container.register(
                'proaPatientClientPersonLinkRunner',
                (c) =>
                    new ProaPatientClientPersonLinkRunner({
                        personMatchManager: c.personMatchManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger,
                        adminLogger: new AdminLogger(),
                        batchSize: 10000,
                        linkClientPersonToProaPatient: true,
                        connectionType: 'proa',
                        clientSourceAssigningAuthorities: ['client'],
                    })
            );

            /**
             * @type {ProaPatientClientPersonLinkRunner}
             */
            const proaPatientClientPersonLinkRunner = container.proaPatientClientPersonLinkRunner;
            assertTypeEquals(proaPatientClientPersonLinkRunner, ProaPatientClientPersonLinkRunner);
            await proaPatientClientPersonLinkRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${clientPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse1);
        });

        test('No change in client person as proa patient is already linked', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([masterPerson2, proaPerson1, clientPerson2, proaPatient, masterPatient])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            container.register(
                'proaPatientClientPersonLinkRunner',
                (c) =>
                    new ProaPatientClientPersonLinkRunner({
                        personMatchManager: c.personMatchManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger,
                        adminLogger: new AdminLogger(),
                        batchSize: 10000,
                        linkClientPersonToProaPatient: true,
                        connectionType: 'proa',
                        clientSourceAssigningAuthorities: ['client'],
                    })
            );

            /**
             * @type {ProaPatientClientPersonLinkRunner}
             */
            const proaPatientClientPersonLinkRunner = container.proaPatientClientPersonLinkRunner;
            assertTypeEquals(proaPatientClientPersonLinkRunner, ProaPatientClientPersonLinkRunner);
            await proaPatientClientPersonLinkRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${clientPerson2._uuid}`)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse2);
        });

        test('Proa patient linked to client person', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([masterPerson2, proaPerson1, clientPerson1, proaPatient, masterPatient])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            container.register(
                'proaPatientClientPersonLinkRunner',
                (c) =>
                    new ProaPatientClientPersonLinkRunner({
                        personMatchManager: c.personMatchManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        preSaveManager: c.preSaveManager,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger,
                        adminLogger: new AdminLogger(),
                        batchSize: 10000,
                        linkClientPersonToProaPatient: true,
                        connectionType: 'proa',
                        clientSourceAssigningAuthorities: ['client-1'],
                    })
            );

            /**
             * @type {ProaPatientClientPersonLinkRunner}
             */
            const proaPatientClientPersonLinkRunner = container.proaPatientClientPersonLinkRunner;
            assertTypeEquals(proaPatientClientPersonLinkRunner, ProaPatientClientPersonLinkRunner);
            await proaPatientClientPersonLinkRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${clientPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse2);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${clientPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(2);
            delete resp.body.entry[1].resource.meta.lastUpdated;
            expect(resp.body.entry[1].resource).toEqual(expectedResponse2);
        });
    });
});
