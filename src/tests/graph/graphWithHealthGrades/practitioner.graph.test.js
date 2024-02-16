// claim
const claimResource = require('./fixtures/claim/explanation_of_benefits.json');
const practitionerResource = require('./fixtures/claim/practitioner.json');
const organizationResource = require('./fixtures/claim/organization.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');
const graphDefinitionClientResource = require('./fixtures/graph/my_graph_client.json');

// expected
const expectedResource = require('./fixtures/expected/expected.json');
const expectedClientResource = require('./fixtures/expected/expectedClient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');
const {IndexProvider} = require('../../../indexes/indexProvider');

class MockConfigManager extends ConfigManager {
    get useAccessIndex() {
        return true;
    }

    get resourcesWithAccessIndex() {
        return ['all'];
    }
}

class MockIndexProvider extends IndexProvider {
    /**
     * @param {string[]} accessCodes
     * @return {boolean}
     */
    hasIndexForAccessCodes({accessCodes}) {
        return accessCodes.every(a => a === 'client');
    }
}

describe('Claim Graph Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph Contained Tests', () => {
        test('Graph contained with multiple targets works properly', async () => {
            const request = await createTestRequest((container) => {
                container.register('indexProvider', (c) => new MockIndexProvider({
                    configManager: c.configManager
                }));
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            let resp = await request
                .get('/4_0_0/ExplanationOfBenefit')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1376656959/$merge')
                .send(practitionerResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/1407857790/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613369/$merge')
                .send(claimResource[0])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$merge')
                .send(claimResource[1])
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post(
                    '/4_0_0/Practitioner/$graph?id=1376656959&contained=true&_debug=1'
                )
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource);

            resp = await request
                .post(
                    '/4_0_0/Practitioner/$graph?id=1376656959&contained=true&_debug=1'
                )
                .set(getHeaders())
                .send(graphDefinitionClientResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedClientResource);
        });
    });
});
