const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {AccessIndexManager} = require('../../../../operations/common/accessIndexManager');
const {ConfigManager} = require('../../../../utils/configManager');
const {IndexProvider} = require('../../../../indexes/indexProvider');

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

    describe('AuditEvent r4 search Tests', () => {
        test('r4 works for Patient without accessIndex', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('indexProvider', () => new MockIndexProvider());
                c.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return c;
            });
            const container = getTestContainer();
            const r4SearchQueryCreator = container.r4SearchQueryCreator;
            const args = {
                '_security': 'https://www.icanbwell.com/access%7Cmedstar',
                'birthdate': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient', args
            });
            expect(result.query.$and['0'].birthDate.$lt).toStrictEqual('2021-09-22T00:00:00+00:00');
            expect(result.query.$and['2']['meta.security.code']).toBe('https://www.icanbwell.com/access%7Cmedstar');
        });
        test('r4 works without accessIndex if access code does not have an index', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('indexProvider', () => new MockIndexProvider());
                c.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return c;
            });
            const container = getTestContainer();
            const r4SearchQueryCreator = container.r4SearchQueryCreator;
            const args = {
                '_security': 'https://www.icanbwell.com/access%7Cfoobar',
                'date': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'AuditEvent', args
            });
            expect(result.query.$and['0'].recorded.$lt).toStrictEqual(new Date('2021-09-22T00:00:00.000Z'));
            expect(result.query.$and['2']['meta.security.code']).toBe('https://www.icanbwell.com/access%7Cfoobar');
        });
        test('r4 works with accessIndex', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('indexProvider', () => new MockIndexProvider());
                c.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return c;
            });
            const container = getTestContainer();
            const r4SearchQueryCreator = container.r4SearchQueryCreator;

            const args = {
                '_security': 'https://www.icanbwell.com/access%7Cmedstar',
                'date': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'AuditEvent', args
            });
            expect(result.query.$and['0'].recorded.$lt).toStrictEqual(new Date('2021-09-22T00:00:00.000Z'));
            expect(result.query.$and['2']).toStrictEqual({'_access.medstar': 1});
        });
        test('r4 works with Task and subject', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('indexProvider', () => new MockIndexProvider());
                c.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return c;
            });
            const container = getTestContainer();
            const r4SearchQueryCreator = container.r4SearchQueryCreator;
            const args = {
                'subject': 'Patient/1234'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task', args
            });
            expect(result.query.$and['0']['for.reference']).toStrictEqual('Patient/1234');
        });
        test('r4 works with Person and multiple patients', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('indexProvider', () => new MockIndexProvider());
                c.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return c;
            });
            const container = getTestContainer();
            const r4SearchQueryCreator = container.r4SearchQueryCreator;
            const args = {
                'patient': '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Person', args
            });
            expect(result.query.$and['0']['link.target.reference'].$in[0]).toStrictEqual('Patient/1234');
            expect(result.query.$and['0']['link.target.reference'].$in[1]).toStrictEqual('Patient/4567');
        });
        test('r4 works with Person and multiple patients with reference type', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('indexProvider', () => new MockIndexProvider());
                c.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return c;
            });
            const container = getTestContainer();
            const r4SearchQueryCreator = container.r4SearchQueryCreator;
            const args = {
                'patient': 'Patient/1234,Patient/4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Person', args
            });
            expect(result.query.$and['0']['link.target.reference'].$in[0]).toStrictEqual('Patient/1234');
            expect(result.query.$and['0']['link.target.reference'].$in[1]).toStrictEqual('Patient/4567');
        });
        test('r4 works with Task and multiple subjects', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('indexProvider', () => new MockIndexProvider());
                c.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return c;
            });
            const container = getTestContainer();
            const r4SearchQueryCreator = container.r4SearchQueryCreator;
            const args = {
                'subject': '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task', args
            });
            expect(result.query.$and['0'].$or[0]['for.reference'].$in[0]).toStrictEqual('Account/1234');
            expect(result.query.$and['0'].$or[0]['for.reference'].$in[1]).toStrictEqual('Account/4567');
        });
        test('r4 works with Task and multiple subjects with reference type', async () => {
            await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('indexProvider', () => new MockIndexProvider());
                c.register('accessIndexManager', (c1) => new MockAccessIndexManager({
                    configManager: c1.configManager,
                    indexProvider: c1.indexProvider
                }));
                return c;
            });
            const container = getTestContainer();
            const r4SearchQueryCreator = container.r4SearchQueryCreator;
            const args = {
                'subject': 'Patient/1234,Patient/4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task', args
            });
            expect(result.query.$and['0']['for.reference'].$in[0]).toStrictEqual('Patient/1234');
            expect(result.query.$and['0']['for.reference'].$in[1]).toStrictEqual('Patient/4567');
        });
    });
});
