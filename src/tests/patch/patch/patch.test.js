// test file
const person1Resource = require('./fixtures/Person/person1.json');
const activitydefinition4Resource = require('./fixtures/ActivityDefinition/activitydefinition4.json');
const activitydefinition5Resource = require('./fixtures/ActivityDefinition/activitydefinition5.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_person.json');
const patch1 = require('./fixtures/patches/patch1.json');
const patch2 = require('./fixtures/patches/patch2.json');
const patch3 = require('./fixtures/patches/patch3.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getHeadersJsonPatch } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const expectedActivityDefinition5Resource = require('./fixtures/expected/expected_ActivityDefinition5.json');
const expectedActivityDefinitionClientResources = require('./fixtures/expected/expected_ActivityDefinitionClient.json');
const expectedActivityDefinitionBwellResources = require('./fixtures/expected/expected_ActivityDefinitionBwell.json');
const expectedErrorWithMultipleDocuments = require('./fixtures/expected/expected_error_with_multiple_documents.json');
const { ConfigManager } = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport () {
        return true;
    }

    get enableReturnBundle () {
        return true;
    }
}

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person patch Tests', () => {
        test('patch works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .patch('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
                .send(patch1)
                .set(getHeadersJsonPatch());

            resp = await request
                .get('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
        test('patch fails with wrong content-type', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .patch('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
                .send(patch1)
                .set(getHeaders());
            expect(resp.body).toStrictEqual({
                'resourceType': 'OperationOutcome',
                'issue': [
                    {
                        'severity': 'error',
                        'code': 'invalid',
                        'details': {
                            'text': 'Content-Type application/fhir+json is not supported for patch. Only application/json-patch+json is supported.'
                        },
                        'diagnostics': 'Content-Type application/fhir+json is not supported for patch. Only application/json-patch+json is supported.'
                    }
                ]
            });
        });
        test('patch fails due to invalid body', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .patch('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
                .send(patch2)
                .set(getHeadersJsonPatch());

            expect(resp.body).toStrictEqual({
                'issue': [
                    {
                        'code': 'invalid',
                        'details': {
                            'text': 'Operation `value` property is not present (applicable in `add`, `replace` and `test` operations)\nname: OPERATION_VALUE_REQUIRED\nindex: 0\noperation: {\n  "op": "replace",\n  "path": "/gender"\n}'
                        },
                        'diagnostics': 'OPERATION_VALUE_REQUIRED: Operation `value` property is not present (applicable in `add`, `replace` and `test` operations)\nname: OPERATION_VALUE_REQUIRED\nindex: 0\noperation: {\n  "op": "replace",\n  "path": "/gender"\n}',
                        'severity': 'error'
                    }
                ],
                'resourceType': 'OperationOutcome'
            });
        });

        test('patch response works when multiple documents with same id are present when accessed from different scopes', async () => {
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

            const clientHeaders = getHeadersJsonPatch('user/*.read user/*.write access/client.*');
            const bwellHeaders = getHeadersJsonPatch('user/*.read user/*.write access/bwell.*');
            resp = await request
                .patch('/4_0_0/ActivityDefinition/sameid')
                .send(patch3)
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

        test('patch response throws validation error when multiple documents with same id are present when accessed from same scopes', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const allAccessHeaders = getHeaders('user/*.read user/*.write access/bwell.* access/client.*');
            const allAccessPatchHeaders = getHeadersJsonPatch('user/*.read user/*.write access/bwell.* access/client.*');
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

            resp = await request
                .patch('/4_0_0/ActivityDefinition/sameid')
                .send(patch3)
                .set(allAccessPatchHeaders)
                .expect(400);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedErrorWithMultipleDocuments);

            resp = await request
                .patch('/4_0_0/ActivityDefinition/sameid|client')
                .send(patch3)
                .set(allAccessPatchHeaders);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedActivityDefinition5Resource);
        });
    });
});
