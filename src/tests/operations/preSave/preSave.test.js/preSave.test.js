const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getTestRequestInfo } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const Resource = require('../../../../fhir/classes/4_0_0/resources/resource');
const { assertTypeEquals } = require('../../../../utils/assertType');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient preSave.test.js Tests', () => {
        const base_version = '4_0_0';
        test('preSave.test.js works', async () => {
            await createTestRequest();
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {PreSaveManager}
             */
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            /**
             * @type {Resource}
             */
            const resource = new Resource({
                id: '123',
                meta: {
                    security: [
                        {
                            system: SecurityTagSystem.access,
                            code: 'myAccess'
                        },
                        {
                            system: SecurityTagSystem.sourceAssigningAuthority,
                            code: 'myAssigningAuthority'
                        }
                    ]
                }
            });
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const result = await preSaveManager.preSaveAsync({ base_version, requestInfo, resource });
            expect(result._uuid).toBeDefined();
            const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
            expect(result._uuid).toMatch(uuidRegex);
            expect(result._sourceId).toStrictEqual('123');
            expect(result._access).toBeDefined();
            expect(result._access.myAccess).toStrictEqual(1);
            expect(result._sourceAssigningAuthority).toBeDefined();
            expect(result._sourceAssigningAuthority).toStrictEqual('myAssigningAuthority');
        });
    });
});
