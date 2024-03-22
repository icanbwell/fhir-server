// test file
const activitydefinition1Resource = require('./fixtures/ActivityDefinition/activitydefinition3.json');
const activitydefinition4Resource = require('./fixtures/ActivityDefinition/activitydefinition4.json');
const activitydefinition5Resource = require('./fixtures/ActivityDefinition/activitydefinition5.json');

// expected
const expectedActivityDefinitionResources = require('./fixtures/expected/expected_ActivityDefinition1.json');
const expectedActivityDefinition5Resource = require('./fixtures/expected/expected_ActivityDefinition5.json');
const expectedActivityDefinitionClientResources = require('./fixtures/expected/expected_ActivityDefinitionClient.json');
const expectedActivityDefinitionBwellResources = require('./fixtures/expected/expected_ActivityDefinitionBwell.json');
const expectedErrorWithMultipleDocuments = require('./fixtures/expected/expected_error_with_multiple_documents.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const deepcopy = require('deepcopy');
const { ConfigManager } = require('../../../utils/configManager');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }
}

describe('ActivityDefinition Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('put with sourceAssigningAuthority works', () => {
        test('put_response works', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);

            activitydefinition1Resource.name = 'TEST1';

            resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);

            resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);

            resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be')
                .send(activitydefinition1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionResources);
        });

        test('put_response works without owner tag', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);

            activitydefinition1Resource.name = 'TEST1';
            const security = activitydefinition1Resource.meta.security;

            activitydefinition1Resource.meta.security = activitydefinition1Resource.meta.security.filter(
                s => s.system !== SecurityTagSystem.owner
            );

            resp = await request
                .put('/4_0_0/ActivityDefinition/ab2d17e3-3996-487c-bf81-cbe31abde0be')
                .send(activitydefinition1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp.body.meta.security).toEqual(expect.arrayContaining(security));
        });

        test('put_response works when multiple documents with same id are present when accessed from different scopes', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const allAccessHeaders = getHeaders('user/*.read user/*.write access/bwell.* access/client.*');
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition5Resource)
                .set(allAccessHeaders)
                .expect(200);

            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition4Resource)
                .set(allAccessHeaders)
                .expect(200);

            const activitydefinition5Data = deepcopy(activitydefinition5Resource);
            activitydefinition5Data.name = 'TEST3';
            const clientHeaders = getHeaders('user/*.read user/*.write access/client.*');
            const bwellHeaders = getHeaders('user/*.read user/*.write access/bwell.*');
            resp = await request
                .put('/4_0_0/ActivityDefinition/sameid')
                .send(activitydefinition5Data)
                .set(clientHeaders)
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinition5Resource);

            resp = await request
                .get('/4_0_0/ActivityDefinition/?_bundle=1')
                .set(clientHeaders);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionClientResources);

            resp = await request
                .get('/4_0_0/ActivityDefinition/?_bundle=1')
                .set(bwellHeaders);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinitionBwellResources);
        });

        test('put_response throws validation error when multiple documents with same id are present when accessed from same scopes', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const allAccessHeaders = getHeaders('user/*.read user/*.write access/bwell.* access/client.*');
            let resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition5Resource)
                .set(allAccessHeaders)
                .expect(200);

            resp = await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(activitydefinition4Resource)
                .set(allAccessHeaders)
                .expect(200);

            const activitydefinition5Data = deepcopy(activitydefinition5Resource);
            activitydefinition5Data.name = 'TEST3';
            resp = await request
                .put('/4_0_0/ActivityDefinition/sameid')
                .send(activitydefinition5Data)
                .set(allAccessHeaders)
                .expect(400);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedErrorWithMultipleDocuments);

            resp = await request
                .put('/4_0_0/ActivityDefinition/sameid|client')
                .send(activitydefinition5Data)
                .set(allAccessHeaders);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinition5Resource);
        });
    });
});
