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
                'base_version': VERSIONS['4_0_0'],
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
                'base_version': VERSIONS['4_0_0'],
                '_security': 'https://www.icanbwell.com/access%7Cfoobar',
                'date': ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'AuditEvent',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'AuditEvent', args})
            });
            expect(result.query.$and['2'].recorded.$gte).toStrictEqual(new Date('2021-09-19T00:00:00Z'));
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
                'base_version': VERSIONS['4_0_0'],
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
                'base_version': VERSIONS['4_0_0'],
                'subject': 'Patient/1234'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: 'Task', args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task', parsedArgs: parsedArgs
            });
            expect(result.query['for._sourceId']).toStrictEqual('Patient/1234');
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
                'base_version': VERSIONS['4_0_0'],
                'patient': '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Person', parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Person', args})
            });
            expect(result.query['link.target._sourceId']['$in']).toStrictEqual(['Patient/1234', 'Patient/4567']);
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
                'base_version': VERSIONS['4_0_0'],
                'patient': 'Patient/1234,Patient/4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Person',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Person', args})
            });
            expect(result.query['link.target._sourceId']['$in']).toStrictEqual(['Patient/1234', 'Patient/4567']);
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
                'base_version': VERSIONS['4_0_0'],
                'subject': '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Task', args})
            });
            expect(result.query['for._sourceId']['$in'][0]).toStrictEqual('Account/1234');
            expect(result.query['for._sourceId']['$in'][1]).toStrictEqual('ActivityDefinition/1234');
            expect(result.query['for._sourceId']['$in'][145]).toStrictEqual('Account/4567');
        });
        test('r4 works with Task and multiple codes', async () => {
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
                'base_version': VERSIONS['4_0_0'],
                'code': '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Task', args})
            });
            expect(result.query['code.coding.code'].$in).toStrictEqual(['1234', '4567']);
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
                'base_version': VERSIONS['4_0_0'],
                'subject': 'Patient/1234,Patient/4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Task', args})
            });
            expect(result.query['for._sourceId']['$in']).toStrictEqual(['Patient/1234', 'Patient/4567']);
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
                'base_version': VERSIONS['4_0_0'],
                'active': 'true'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'PractitionerRole',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'PractitionerRole', args})
            });
            expect(result.query.active).toStrictEqual(true);
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
                'base_version': VERSIONS['4_0_0'],
                'active': 'false'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'PractitionerRole',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'PractitionerRole', args})
            });
            expect(result.query.active).toStrictEqual(false);
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
                'base_version': VERSIONS['4_0_0'],
                'id': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3',
                'id:above': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query.$and['0']._sourceId).toStrictEqual('john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3');
            expect(result.query.$and['1']._sourceId).toStrictEqual({
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
                'base_version': VERSIONS['4_0_0'],
                '_id:not': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query.$nor['0']._sourceId).toStrictEqual('john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3');
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
                'base_version': VERSIONS['4_0_0'],
                '_security:not': 'https://www.icanbwell.com/access|bwell',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query.$nor['0']['meta.security'].$elemMatch).toStrictEqual({
                'system': 'https://www.icanbwell.com/access',
                'code': 'bwell'
            });
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
                'base_version': VERSIONS['4_0_0'],
                '_security:not': 'https://www.icanbwell.com/access|bwell',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query.$nor['0']['meta.security'].$elemMatch).toStrictEqual({
                'system': 'https://www.icanbwell.com/access',
                'code': 'bwell'
            });
        });
        test('r4 works with :contains for identifier value', async () => {
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
                'base_version': VERSIONS['4_0_0'],
                'identifier:contains': '465',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query).toStrictEqual({
                'identifier.value': {
                    '$regex': '465',
                    '$options': 'i'
                }
            });
        });
        test('r4 works with :contains for identifier multiple values', async () => {
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
                'base_version': VERSIONS['4_0_0'],
                'identifier:contains': '465,789',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {
                        'identifier.value': {
                            '$options': 'i',
                            '$regex': '465'
                        }
                    },
                    {
                        'identifier.value': {
                            '$options': 'i',
                            '$regex': '789'
                        }
                    }
                ]
            });
        });
        test('r4 works with :contains for identifier value and system', async () => {
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
                'base_version': VERSIONS['4_0_0'],
                'identifier:contains': 'foo|465',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query).toStrictEqual({
                'identifier': {
                    '$elemMatch': {
                        'system': {
                            '$options': 'i',
                            '$regex': 'foo'
                        },
                        'value': {
                            '$options': 'i',
                            '$regex': '465'
                        }
                    }
                }
            });
        });
        test('r4 works with :contains for name in Patient', async () => {
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
                'base_version': VERSIONS['4_0_0'],
                'given:contains': 'foo',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query).toStrictEqual({
                'name.given': {
                    '$options': 'i',
                    '$regex': 'foo'
                }
            });
        });
        test('r4 works with :contains for gender in Patient', async () => {
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
                'base_version': VERSIONS['4_0_0'],
                'gender:contains': 'foo',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Patient', args})
            });
            expect(result.query).toStrictEqual({
                'gender': {
                    '$options': 'i',
                    '$regex': 'foo'
                }
            });
        });
        test('r4 works with depends-upon in Measure', async () => {
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
                'base_version': VERSIONS['4_0_0'],
                'depends-on': 'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Measure',
                parsedArgs: r4ArgsParser.parseArgs({resourceType: 'Measure', args})
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {
                        'relatedArtifact.resource._sourceId': {
                            '$in': [
                                'Library/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Account/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ActivityDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'AdverseEvent/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'AllergyIntolerance/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Appointment/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'AppointmentResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'AuditEvent/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Basic/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Binary/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'BiologicallyDerivedProduct/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'BodyStructure/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Bundle/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CapabilityStatement/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CarePlan/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CareTeam/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CatalogEntry/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ChargeItem/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ChargeItemDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Claim/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ClaimResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ClinicalImpression/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CodeSystem/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Communication/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CommunicationRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CompartmentDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Composition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ConceptMap/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Condition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Consent/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Contract/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Coverage/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CoverageEligibilityRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CoverageEligibilityResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DetectedIssue/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Device/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DeviceDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DeviceMetric/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DeviceRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DeviceUseStatement/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DiagnosticReport/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DocumentManifest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DocumentReference/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EffectEvidenceSynthesis/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Encounter/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Endpoint/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EnrollmentRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EnrollmentResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EpisodeOfCare/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EventDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Evidence/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EvidenceVariable/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ExampleScenario/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ExplanationOfBenefit/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'FamilyMemberHistory/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Flag/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Goal/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'GraphDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Group/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'GuidanceResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'HealthcareService/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ImagingStudy/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Immunization/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ImmunizationEvaluation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ImmunizationRecommendation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ImplementationGuide/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'InsurancePlan/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Invoice/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Linkage/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'List/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Location/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Measure/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MeasureReport/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Media/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Medication/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationAdministration/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationDispense/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationKnowledge/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationStatement/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProduct/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductAuthorization/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductContraindication/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductIndication/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductIngredient/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductInteraction/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductManufactured/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductPackaged/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductPharmaceutical/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductUndesirableEffect/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MessageDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MessageHeader/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MolecularSequence/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'NamingSystem/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'NutritionOrder/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Observation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ObservationDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'OperationDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'OperationOutcome/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Organization/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'OrganizationAffiliation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Patient/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'PaymentNotice/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'PaymentReconciliation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Person/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'PlanDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Practitioner/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'PractitionerRole/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Procedure/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Provenance/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Questionnaire/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'QuestionnaireResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'RelatedPerson/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'RequestGroup/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ResearchDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ResearchElementDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ResearchStudy/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ResearchSubject/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'RiskAssessment/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'RiskEvidenceSynthesis/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Schedule/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SearchParameter/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ServiceRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Slot/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Specimen/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SpecimenDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'StructureDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'StructureMap/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Subscription/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Substance/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceNucleicAcid/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstancePolymer/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceProtein/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceReferenceInformation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceSourceMaterial/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceSpecification/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SupplyDelivery/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SupplyRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Task/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'TerminologyCapabilities/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'TestReport/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'TestScript/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ValueSet/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'VerificationResult/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'VisionPrescription/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
                            ]
                        }
                    },
                    {
                        'library._sourceId': {
                            '$in': [
                                'Library/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Account/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ActivityDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'AdverseEvent/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'AllergyIntolerance/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Appointment/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'AppointmentResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'AuditEvent/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Basic/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Binary/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'BiologicallyDerivedProduct/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'BodyStructure/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Bundle/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CapabilityStatement/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CarePlan/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CareTeam/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CatalogEntry/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ChargeItem/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ChargeItemDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Claim/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ClaimResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ClinicalImpression/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CodeSystem/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Communication/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CommunicationRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CompartmentDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Composition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ConceptMap/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Condition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Consent/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Contract/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Coverage/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CoverageEligibilityRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'CoverageEligibilityResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DetectedIssue/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Device/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DeviceDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DeviceMetric/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DeviceRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DeviceUseStatement/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DiagnosticReport/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DocumentManifest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'DocumentReference/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EffectEvidenceSynthesis/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Encounter/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Endpoint/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EnrollmentRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EnrollmentResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EpisodeOfCare/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EventDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Evidence/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'EvidenceVariable/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ExampleScenario/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ExplanationOfBenefit/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'FamilyMemberHistory/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Flag/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Goal/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'GraphDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Group/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'GuidanceResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'HealthcareService/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ImagingStudy/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Immunization/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ImmunizationEvaluation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ImmunizationRecommendation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ImplementationGuide/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'InsurancePlan/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Invoice/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Linkage/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'List/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Location/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Measure/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MeasureReport/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Media/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Medication/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationAdministration/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationDispense/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationKnowledge/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicationStatement/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProduct/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductAuthorization/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductContraindication/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductIndication/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductIngredient/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductInteraction/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductManufactured/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductPackaged/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductPharmaceutical/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MedicinalProductUndesirableEffect/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MessageDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MessageHeader/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'MolecularSequence/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'NamingSystem/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'NutritionOrder/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Observation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ObservationDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'OperationDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'OperationOutcome/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Organization/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'OrganizationAffiliation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Patient/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'PaymentNotice/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'PaymentReconciliation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Person/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'PlanDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Practitioner/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'PractitionerRole/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Procedure/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Provenance/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Questionnaire/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'QuestionnaireResponse/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'RelatedPerson/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'RequestGroup/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ResearchDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ResearchElementDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ResearchStudy/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ResearchSubject/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'RiskAssessment/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'RiskEvidenceSynthesis/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Schedule/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SearchParameter/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ServiceRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Slot/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Specimen/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SpecimenDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'StructureDefinition/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'StructureMap/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Subscription/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Substance/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceNucleicAcid/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstancePolymer/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceProtein/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceReferenceInformation/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceSourceMaterial/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SubstanceSpecification/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SupplyDelivery/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'SupplyRequest/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'Task/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'TerminologyCapabilities/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'TestReport/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'TestScript/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'ValueSet/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'VerificationResult/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN',
                                'VisionPrescription/https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
                            ]
                        }
                    }
                ]
            });
        });
    });
});
