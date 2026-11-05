const observationNoTagResource = require('./fixtures/ObservationNoTag.json');
const observationWithTagResource = require('./fixtures/ObservationWithTag.json');

const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer, getTestRequestInfo } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { PreSaveManager } = require('../../../../../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../../../../../preSaveHandlers/preSaveOptions');
const { ConfigManager } = require('../../../../../utils/configManager');
const deepcopy = require('deepcopy');
const { assertTypeEquals } = require('../../../../../utils/assertType');
const { SENSITIVE_CATEGORY } = require('../../../../../constants');

class MockConfigManager extends ConfigManager {
    get resourceTypesForUnclassifiedTagging () {
        return new Set(['Observation']);
    }
}

describe('PreSave UnclassifiedSensitivityTag Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('PreSave unclassified sensitivity tag', () => {
        test('adds unclassified tag to configured resource type', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const container = getTestContainer();
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const options = PreSaveOptions.fromRequestInfo(requestInfo);
            const resource = deepcopy(observationNoTagResource);

            const result = await preSaveManager.preSaveAsync({ resource, options });

            const newResource = result;
            const tag = newResource.meta.security.find(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(tag).toBeDefined();
            expect(tag.id).toBeDefined();
            expect(tag.system).toStrictEqual(SENSITIVE_CATEGORY.SYSTEM);
            expect(tag.code).toStrictEqual(SENSITIVE_CATEGORY.UNCLASSIFIED_CODE);
        });

        test('adds the tag as a plain object', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const container = getTestContainer();
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const options = PreSaveOptions.fromRequestInfo(requestInfo);
            const resource = {
                resourceType: 'Observation',
                id: 'obs-plain',
                status: 'final',
                code: { text: 'x' },
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'bwell' }] }
            };

            const result = await preSaveManager.preSaveAsync({ resource, options });

            const tag = result.meta.security.find(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(tag).toBeDefined();
            expect(tag.id).toBeDefined();
            expect(tag.constructor).toBe(Object);
        });

        test('does not add tag to unconfigured resource type', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const container = getTestContainer();
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const options = PreSaveOptions.fromRequestInfo(requestInfo);
            const resource = {
                resourceType: 'Patient',
                id: 'patient-1',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'healthsystem1' }
                    ]
                }
            };

            const result = await preSaveManager.preSaveAsync({ resource, options });

            const tag = result.meta?.security?.find(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(tag).toBeUndefined();
        });

        test('preserves existing unclassified tag', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const container = getTestContainer();
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const options = PreSaveOptions.fromRequestInfo(requestInfo);
            const resource = deepcopy(observationWithTagResource);

            const result = await preSaveManager.preSaveAsync({ resource, options });

            const newResource = result;
            const tags = newResource.meta.security.filter(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(tags).toHaveLength(1);
        });

        test('deduplicates multiple unclassified tags to exactly one', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const container = getTestContainer();
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const requestInfo = getTestRequestInfo({ requestId: '1234' });
            const options = PreSaveOptions.fromRequestInfo(requestInfo);
            const resource = {
                ...deepcopy(observationWithTagResource),
                meta: {
                    ...observationWithTagResource.meta,
                    security: [
                        ...observationWithTagResource.meta.security,
                        {
                            system: SENSITIVE_CATEGORY.SYSTEM,
                            code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
                        },
                        {
                            system: SENSITIVE_CATEGORY.SYSTEM,
                            code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
                        }
                    ]
                }
            };

            const result = await preSaveManager.preSaveAsync({ resource, options });

            const newResource = result;
            const tags = newResource.meta.security.filter(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(tags).toHaveLength(1);
            expect(tags[0].id).toBeDefined();
        });

        test('suppress header skips adding tag (no existing tag)', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const container = getTestContainer();
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const options = new PreSaveOptions({ suppressUnclassifiedTag: true });
            const resource = deepcopy(observationNoTagResource);

            const result = await preSaveManager.preSaveAsync({ resource, options });

            const newResource = result;
            const tag = newResource.meta.security.find(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(tag).toBeUndefined();
        });

        test('suppress header preserves existing unclassified tag', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const container = getTestContainer();
            const preSaveManager = container.preSaveManager;
            assertTypeEquals(preSaveManager, PreSaveManager);
            const options = new PreSaveOptions({ suppressUnclassifiedTag: true });
            const resource = deepcopy(observationWithTagResource);

            const result = await preSaveManager.preSaveAsync({ resource, options });

            const newResource = result;
            const tags = newResource.meta.security.filter(
                s => s.system === SENSITIVE_CATEGORY.SYSTEM && s.code === SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
            );
            expect(tags).toHaveLength(1);
            expect(tags[0].id).toBeDefined();
        });
    });
});
