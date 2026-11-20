/**
 * The Consent lookup of a user read must be answered from the `consent_of_linked_person` index, never
 * a collection scan: it runs on every read of an enrolled user, and the `status: active` filter exists
 * to keep it on that index. The production indexes are built after seeding, because `$merge` creates
 * collections with only the _id index. All data is synthetic.
 */
const { describe, beforeAll, afterAll, test, expect, jest: jestObj } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../../common');
const { PatientDataViewControlManager } = require('../../../../utils/patientDataViewController');
const { OWNER, userHeaders } = require('./viewControlUserFixtures');

const fx = (p) => require(`./fixtures/${p}`);
const CONSENT_INDEX = 'consent_of_linked_person';

/** the names of every index the winning plan reads, however deeply it is nested */
function indexNamesIn(plan) {
    const names = [];
    const walk = (node) => {
        if (Array.isArray(node)) {
            node.forEach(walk);
        } else if (node && typeof node === 'object') {
            if (node.indexName) {
                names.push(node.indexName);
            }
            Object.values(node).forEach(walk);
        }
    };
    walk(plan);
    return names;
}

describe('dataConnectionViewControl Consent lookup query plan', () => {
    let savedEnrolled;
    let request;

    beforeAll(async () => {
        savedEnrolled = process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = OWNER;
        await commonBeforeEach();
        request = await createTestRequest();
        for (const p of ['Person/topLevelPerson.json', 'Person/person1.json', 'Patient/patient1.json', 'CarePlan/carePlan.json']) {
            const resp = await request.post(`/4_0_0/${p.split('/')[0]}/1/$merge`).send(fx(p)).set(getHeaders());
            expect(resp.status).toBe(200);
        }
        // other users' Consents, so a scan would be visible in the plan
        const others = Array.from({ length: 20 }, (_, i) => {
            const other = deepcopy(fx('Consent/consent1.json'));
            other.id = `vc-index-other-consent-${i}`;
            other.patient = { reference: `Patient/person.00000000-0000-5000-8000-0000000000${String(i).padStart(2, '0')}` };
            return other;
        });
        const resp = await request.post('/4_0_0/Consent/1/$merge').send([fx('Consent/consent1.json'), ...others]).set(getHeaders());
        expect(resp.status).toBe(200);
        // build the production indexes (customIndexes.js)
        const container = getTestContainer();
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        for (const { name } of await db.listCollections().toArray()) {
            await container.indexManager.indexCollectionAsync({ collectionName: name, db });
        }
    });

    afterAll(async () => {
        if (savedEnrolled === undefined) {
            delete process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        } else {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = savedEnrolled;
        }
        await commonAfterEach();
    });

    test('the Consent lookup query reads the consent_of_linked_person index, not the collection', async () => {
        const spy = jestObj.spyOn(PatientDataViewControlManager.prototype, 'getConsentAsync');
        try {
            expect((await request.get('/4_0_0/CarePlan').set(userHeaders())).status).toBe(200);
            const { viewControlConsentQueries } = await spy.mock.results[0].value;
            expect(viewControlConsentQueries).toHaveLength(1);
            const { query, collectionName } = viewControlConsentQueries[0];
            const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
            const { queryPlanner } = await db.collection(collectionName).find(query).explain('queryPlanner');
            const plan = JSON.stringify(queryPlanner.winningPlan);
            expect(plan).not.toContain('COLLSCAN');
            expect(indexNamesIn(queryPlanner.winningPlan)).toContain(CONSENT_INDEX);
        } finally {
            spy.mockRestore();
        }
    });
});
