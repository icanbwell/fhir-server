// test file
const masterPerson1 = require('./fixtures/person/masterPerson1.json');
const masterPerson2 = require('./fixtures/person/masterPerson2.json');
const proaPerson1 = require('./fixtures/person/proaPerson1.json');
const proaPerson2 = require('./fixtures/person/proaPerson2.json');
const clientPerson1 = require('./fixtures/person/clientPerson1.json');
const clientPerson2 = require('./fixtures/person/clientPerson2.json');

const proaPatient = require('./fixtures/patient/proaPatient.json');
const proaPatient2 = require('./fixtures/patient/proaPatient2.json');
const masterPatient = require('./fixtures/patient/masterPatient.json');

// expected
const expectedResponse1 = require('./fixtures/expected/expectedResponse1.json');
const expectedResponse3 = require('./fixtures/expected/expectedResponse3.json');
const expectedResponse4 = require('./fixtures/expected/expectedResponse4.json');
const expectedResponse5 = require('./fixtures/expected/expectedResponse5.json');

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
    DelinkProaPersonPatientRunner,
} = require('../../../../admin/runners/delinkProaPersonPatientRunner');

describe('Proa patient client persons delinking tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.delinkProaPersonPatientRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Test cases for delinking of proa person with proa patient & master person', () => {
        test('No delinking/removal happens as the master person does not have any master patient linked', async () => {
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
                'delinkProaPersonPatientRunner',
                (c) =>
                    new DelinkProaPersonPatientRunner({
                        personMatchManager: c.personMatchManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        databaseUpdateFactory: c.databaseUpdateFactory,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger,
                        adminLogger: new AdminLogger(),
                        batchSize: 10000,
                        delinkRemoveProaPerson: true,
                        connectionType: 'proa',
                    })
            );

            /**
             * @type {DelinkProaPersonPatientRunner}
             */
            const delinkProaPersonPatientRunner = container.delinkProaPersonPatientRunner;
            assertTypeEquals(delinkProaPersonPatientRunner, DelinkProaPersonPatientRunner);
            await delinkProaPersonPatientRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${clientPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse1);
        });

        test('No delinking/removal happens as the proa patient is not linked to client person', async () => {
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
                'delinkProaPersonPatientRunner',
                (c) =>
                    new DelinkProaPersonPatientRunner({
                        personMatchManager: c.personMatchManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        databaseUpdateFactory: c.databaseUpdateFactory,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger,
                        adminLogger: new AdminLogger(),
                        batchSize: 10000,
                        delinkRemoveProaPerson: true,
                        connectionType: 'proa',
                    })
            );

            /**
             * @type {DelinkProaPersonPatientRunner}
             */
            const delinkProaPersonPatientRunner = container.delinkProaPersonPatientRunner;
            assertTypeEquals(delinkProaPersonPatientRunner, DelinkProaPersonPatientRunner);
            await delinkProaPersonPatientRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${clientPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse1);
        });

        test('Proa patient linked to client person', async () => {
            // Here proaPerson1 will not be removed as it has 1 proa patient not linked to client person
            // proaPerson2 will be removed

            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();
            const container = getTestContainer();

            // Add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send([
                    masterPerson1,
                    masterPerson2,
                    masterPatient,
                    clientPerson2,
                    proaPerson1,
                    proaPerson2,
                    proaPatient,
                    proaPatient2,
                ])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            container.register(
                'delinkProaPersonPatientRunner',
                (c) =>
                    new DelinkProaPersonPatientRunner({
                        personMatchManager: c.personMatchManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        databaseUpdateFactory: c.databaseUpdateFactory,
                        databaseQueryFactory: c.databaseQueryFactory,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        resourceMerger: c.resourceMerger,
                        adminLogger: new AdminLogger(),
                        batchSize: 10000,
                        delinkRemoveProaPerson: true,
                        connectionType: 'proa',
                    })
            );

            /**
             * @type {DelinkProaPersonPatientRunner}
             */
            const delinkProaPersonPatientRunner = container.delinkProaPersonPatientRunner;
            assertTypeEquals(delinkProaPersonPatientRunner, DelinkProaPersonPatientRunner);
            await delinkProaPersonPatientRunner.processAsync();

            // This proaPerson1 will have no link for proaPatient now
            resp = await request
                .get(`/4_0_0/Person/${proaPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse3);

            // This proaPerson2 must not be found now
            resp = await request
                .get(`/4_0_0/Person/${proaPerson2._uuid}`)
                .set(getHeaders())
                .expect(404);

            // masterPerson1 will not have link for proaPerson2 now
            resp = await request
                .get(`/4_0_0/Person/${masterPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse4);

            // masterPerson2 will not be changed
            resp = await request
                .get(`/4_0_0/Person/${masterPerson2._uuid}`)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse5);

            // History for proaPerson1
            resp = await request
                .get(`/4_0_0/Person/_history?id=${proaPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(2);
            delete resp.body.entry[1].resource.meta.lastUpdated;
            expect(resp.body.entry[1].resource).toEqual(expectedResponse3);

            // No extra history for proaPerson2 must be made as it is deleted.
            resp = await request
                .get(`/4_0_0/Person/_history?id=${proaPerson2._uuid}`)
                .set(getHeaders())
                .expect(200);
            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(1);

            // History for masterPerson1
            resp = await request
                .get(`/4_0_0/Person/_history?id=${masterPerson1._uuid}`)
                .set(getHeaders())
                .expect(200);
            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(2);
            delete resp.body.entry[1].resource.meta.lastUpdated;
            expect(resp.body.entry[1].resource).toEqual(expectedResponse4);

            // No extra history for masterPerson2
            resp = await request
                .get(`/4_0_0/Person/_history?id=${masterPerson2._uuid}`)
                .set(getHeaders())
                .expect(200);
            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(1);
        });
    });
});
