const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {AccessIndexManager} = require('../../../../operations/common/accessIndexManager');
const {ConfigManager} = require('../../../../utils/configManager');
const {IndexProvider} = require('../../../../indexes/indexProvider');
const {VERSIONS} = require('../../../../middleware/fhir/utils/constants');

class MockAccessIndexManager extends AccessIndexManager {
    resourceHasAccessIndexForAccessCodes({resourceType, accessCodes}) {
        return ['AuditEvent', 'Task'].includes(resourceType) &&
            accessCodes.every(a => a === 'medstar');
    }
}

class MockConfigManager extends ConfigManager {
    get useAccessIndex() {
        return true;
    }
}

class MockIndexProvider extends IndexProvider {
    hasIndexForAccessCodes({accessCodes}) {
        return accessCodes.every(ac => ac === 'medstar');
    }
}

describe('r4 search Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('r4 search Tests', () => {
        test('single uuid reference without resourceType', async () => {
            await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                container.register('indexProvider', (c) => new MockIndexProvider({
                    configManager: c.configManager
                }));
                container.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return container;
            });
            const container = getTestContainer();
            /**
             * @type {R4SearchQueryCreator}
             */
            const r4SearchQueryCreator = container.r4SearchQueryCreator;
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const resourceType = 'Condition';
            const args = {
                'base_version': VERSIONS['4_0_0'],
                'patient': '7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    '$in': [
                        'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                        'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                    ]
                }
            });
        });
    });
});
