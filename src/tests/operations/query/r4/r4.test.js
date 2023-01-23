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

    describe('r4 search Tests', () => {
        test('r4 works for Patient without accessIndex', async () => {
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
            const args = {
                '_security': 'https://www.icanbwell.com/access%7Cmedstar',
                'birthdate': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query.$and['1'].birthDate.$lt).toStrictEqual('2021-09-22T00:00:00+00:00');
            expect(result.query.$and['0']['meta.security.code']).toBe('https://www.icanbwell.com/access%7Cmedstar');
        });
        test('r4 works without accessIndex if access code does not have an index', async () => {
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

            const args = {
                '_security': 'https://www.icanbwell.com/access%7Cfoobar',
                'date': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'AuditEvent',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'AuditEvent', args})
            });
            expect(result.query.$and['1'].recorded.$lt).toStrictEqual(new Date('2021-09-22T00:00:00.000Z'));
            expect(result.query.$and['0']['meta.security.code']).toBe('https://www.icanbwell.com/access%7Cfoobar');
        });
        test('r4 works with accessIndex', async () => {
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


            const args = {
                '_security': 'https://www.icanbwell.com/access%7Cmedstar',
                'date': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'AuditEvent',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'AuditEvent', args})
            });
            expect(result.query.$and['1'].recorded.$lt).toStrictEqual(new Date('2021-09-22T00:00:00.000Z'));
            expect(result.query.$and['0']).toStrictEqual({'_access.medstar': 1});
        });
        test('r4 works with Task and subject', async () => {
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

            const args = {
                'subject': 'Patient/1234'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task', parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Task', args})
            });
            expect(result.query.$and['0']['for.reference']).toStrictEqual('Patient/1234');
        });
        test('r4 works with Person and multiple patients', async () => {
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

            const args = {
                'patient': '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Person', parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Person', args})
            });
            expect(result.query.$and['0']['link.target.reference'].$in[0]).toStrictEqual('Patient/1234');
            expect(result.query.$and['0']['link.target.reference'].$in[1]).toStrictEqual('Patient/4567');
        });
        test('r4 works with Person and multiple patients with reference type', async () => {
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

            const args = {
                'patient': 'Patient/1234,Patient/4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Person',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Person', args})
            });
            expect(result.query.$and['0']['link.target.reference'].$in[0]).toStrictEqual('Patient/1234');
            expect(result.query.$and['0']['link.target.reference'].$in[1]).toStrictEqual('Patient/4567');
        });
        test('r4 works with Task and multiple subjects', async () => {
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

            const args = {
                'subject': '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Task', args})
            });
            expect(result.query.$and['0'].$or[0]['for.reference'].$in[0]).toStrictEqual('Account/1234');
            expect(result.query.$and['0'].$or[0]['for.reference'].$in[1]).toStrictEqual('Account/4567');
        });
        test('r4 works with Task and multiple subjects with reference type', async () => {
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

            const args = {
                'subject': 'Patient/1234,Patient/4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Task', args})
            });
            expect(result.query.$and['0']['for.reference'].$in[0]).toStrictEqual('Patient/1234');
            expect(result.query.$and['0']['for.reference'].$in[1]).toStrictEqual('Patient/4567');
        });
        test('r4 works with boolean type true', async () => {
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

            const args = {
                'active': 'true'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'PractitionerRole',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'PractitionerRole', args})
            });
            expect(result.query.$and['0'].active).toStrictEqual(true);
        });
        test('r4 works with boolean type false', async () => {
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

            const args = {
                'active': 'false'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'PractitionerRole',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'PractitionerRole', args})
            });
            expect(result.query.$and['0'].active).toStrictEqual(false);
        });
        test('r4 works when both id and id:above are passed', async () => {
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

            const args = {
                'id': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3',
                'id:above': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query.$and['0'].id).toStrictEqual('john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3');
            expect(result.query.$and['1'].$or[0].id).toStrictEqual({
                '$gt': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3'
            });
        });
        test('r4 works with :not for id', async () => {
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

            const args = {
                '_id:not': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query.$and['0'].$nor['0'].id).toStrictEqual('john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3');
        });
        test('r4 works with :not for _security', async () => {
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

            const args = {
                '_security:not': 'https://www.icanbwell.com/access|bwell',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query.$and['0'].$nor['0']['meta.security'].$elemMatch).toStrictEqual({
                'system': 'https://www.icanbwell.com/access',
                'code': 'bwell'
            });
        });
    });
});
