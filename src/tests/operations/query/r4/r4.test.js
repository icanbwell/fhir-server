const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AccessIndexManager } = require('../../../../operations/common/accessIndexManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { IndexProvider } = require('../../../../indexes/indexProvider');
const { VERSIONS } = require('../../../../middleware/fhir/utils/constants');

class MockAccessIndexManager extends AccessIndexManager {
    resourceHasAccessIndexForAccessCodes ({ resourceType, accessCodes }) {
        return ['AuditEvent', 'Task'].includes(resourceType) &&
            accessCodes.every(a => a === 'client');
    }
}

class MockConfigManager extends ConfigManager {
    get useAccessIndex () {
        return true;
    }
}

class MockIndexProvider extends IndexProvider {
    hasIndexForAccessCodes ({ accessCodes }) {
        return accessCodes.every(ac => ac === 'client');
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
                base_version: VERSIONS['4_0_0'],
                _security: 'https://www.icanbwell.com/access%7Cclient',
                birthdate: ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query.$and['2'].birthDate.$lt).toStrictEqual('2021-09-22T00:00:00+00:00');
            expect(result.query.$and['0']['meta.security.code']).toBe('https://www.icanbwell.com/access%7Cclient');
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
                base_version: VERSIONS['4_0_0'],
                _security: 'https://www.icanbwell.com/access%7Cfoobar',
                date: ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'AuditEvent',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'AuditEvent', args })
            });
            expect(result.query.$and['1'].recorded.$gte).toStrictEqual(new Date('2021-09-19T00:00:00Z'));
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
                base_version: VERSIONS['4_0_0'],
                _security: 'https://www.icanbwell.com/access%7Cclient',
                date: ['lt2021-09-22T00:00:00Z', 'ge2021-09-19T00:00:00Z']
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'AuditEvent',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'AuditEvent', args })
            });
            expect(result.query.$and['1'].recorded.$lt).toStrictEqual(new Date('2021-09-22T00:00:00.000Z'));
            expect(result.query.$and['0']).toStrictEqual({ '_access.client': 1 });
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
                base_version: VERSIONS['4_0_0'],
                subject: 'Patient/1234'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType: 'Task', args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task', parsedArgs
            });
            expect(result.query.$and[0]['for._sourceId']).toStrictEqual('Patient/1234');
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
                base_version: VERSIONS['4_0_0'],
                patient: '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Person', parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Person', args })
            });
            expect(result.query.$and[0]['link.target._sourceId'].$in).toStrictEqual(['Patient/1234', 'Patient/4567']);
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/1234,Patient/4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Person',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Person', args })
            });
            expect(result.query.$and[0]['link.target._sourceId'].$in).toStrictEqual(['Patient/1234', 'Patient/4567']);
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
                base_version: VERSIONS['4_0_0'],
                subject: '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Task', args })
            });
            expect(result.query.$and[0]['for._sourceId'].$in[0]).toStrictEqual('Account/1234');
            expect(result.query.$and[0]['for._sourceId'].$in[1]).toStrictEqual('ActivityDefinition/1234');
            expect(result.query.$and[0]['for._sourceId'].$in[140]).toStrictEqual('Account/4567');
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
                base_version: VERSIONS['4_0_0'],
                code: '1234,4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Task', args })
            });
            expect(result.query.$and[0]['code.coding.code'].$in).toStrictEqual(['1234', '4567']);
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
                base_version: VERSIONS['4_0_0'],
                subject: 'Patient/1234,Patient/4567'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Task',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Task', args })
            });
            expect(result.query.$and[0]['for._sourceId'].$in).toStrictEqual(['Patient/1234', 'Patient/4567']);
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
                base_version: VERSIONS['4_0_0'],
                active: 'true'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'PractitionerRole',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'PractitionerRole', args })
            });
            expect(result.query.$and[0].active).toStrictEqual(true);
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
                base_version: VERSIONS['4_0_0'],
                active: 'false'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'PractitionerRole',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'PractitionerRole', args })
            });
            expect(result.query.$and[0].active).toStrictEqual(false);
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
                base_version: VERSIONS['4_0_0'],
                id: 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3',
                'id:above': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query.$and['0']._sourceId).toStrictEqual('john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3');
            expect(result.query.$and['1']._sourceId).toStrictEqual({
                $gt: 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3'
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
                base_version: VERSIONS['4_0_0'],
                '_id:not': 'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query.$and[0].$nor[0]._sourceId).toStrictEqual(
                'john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3'
            );
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
                base_version: VERSIONS['4_0_0'],
                '_security:not': 'https://www.icanbwell.com/access|bwell'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query.$and[0].$nor[0]['meta.security'].$elemMatch).toStrictEqual({
                system: 'https://www.icanbwell.com/access',
                code: 'bwell'
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
                base_version: VERSIONS['4_0_0'],
                '_security:not': 'https://www.icanbwell.com/access|bwell'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query.$and[0].$nor[0]['meta.security'].$elemMatch).toStrictEqual({
                system: 'https://www.icanbwell.com/access',
                code: 'bwell'
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
                base_version: VERSIONS['4_0_0'],
                'identifier:contains': '465'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query).toStrictEqual({
                $and: [
                    {
                        'identifier.value': {
                            $regex: '465',
                            $options: 'i'
                        }
                    },
                    {
                        'meta.tag': {
                            $not: {
                                $elemMatch: {
                                    code: 'hidden',
                                    system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior'
                                }
                            }
                        }
                    }
                ]
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
                base_version: VERSIONS['4_0_0'],
                'identifier:contains': '465,789'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query).toStrictEqual({
                $and: [
                    {
                        $or: [
                                {
                                    'identifier.value': {
                                        $options: 'i',
                                        $regex: '465'
                                    }
                                },
                                {
                                    'identifier.value': {
                                        $options: 'i',
                                        $regex: '789'
                                    }
                                }
                        ]
                    },
                    {
                        'meta.tag': {
                            $not: {
                                $elemMatch: {
                                    code: 'hidden',
                                    system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior'
                                }
                            }
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
                base_version: VERSIONS['4_0_0'],
                'identifier:contains': 'foo|465'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query).toStrictEqual({
                $and: [
                    {
                        identifier: {
                            $elemMatch: {
                                system: {
                                    $options: 'i',
                                    $regex: 'foo'
                                },
                                value: {
                                    $options: 'i',
                                    $regex: '465'
                                }
                            }
                        }
                    },
                    {
                        'meta.tag': {
                            $not: {
                                $elemMatch: {
                                    code: 'hidden',
                                    system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior'
                                }
                            }
                        }
                    }
                ]
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
                base_version: VERSIONS['4_0_0'],
                'given:contains': 'foo'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query).toStrictEqual({
                $and: [
                    {
                        'name.given': {
                            $options: 'i',
                            $regex: 'foo'
                        }
                    },
                    {
                        'meta.tag': {
                            $not: {
                                $elemMatch: {
                                    code: 'hidden',
                                    system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior'
                                }
                            }
                        }
                    }
                ]
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
                base_version: VERSIONS['4_0_0'],
                'gender:contains': 'foo'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Patient',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Patient', args })
            });
            expect(result.query).toStrictEqual({
                $and: [
                    {
                        gender: {
                            $options: 'i',
                            $regex: 'foo'
                        }
                    },
                    {
                        'meta.tag': {
                            $not: {
                                $elemMatch: {
                                    code: 'hidden',
                                    system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior'
                                }
                            }
                        }
                    }
                ]
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
                base_version: VERSIONS['4_0_0'],
                'depends-on': 'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Measure',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Measure', args })
            });
            expect(result.query).toStrictEqual(
                {
                    $and: [
                        {
                            $or: [
                                {
                                    'relatedArtifact.resource': 'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
                                },
                                {
                                    library: 'https://fhir.dev.icanbwell.com/4_0_0/Library/AWVCN'
                                }
                            ]
                        },
                        {
                            'meta.tag': {
                                $not: {
                                    $elemMatch: {
                                        code: 'hidden',
                                        system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior'
                                    }
                                }
                            }
                        }
                    ]
                });
        });
        test('r4 works with date without microseconds in Observation', async () => {
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
                base_version: VERSIONS['4_0_0'],
                date: '2019-10-16T22:12:29'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Observation',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Observation', args })
            });
            // need to convert dates to strings to make match work
            result.query.$and['0'].$or['2'].effectiveInstant.$gte = result.query.$and['0'].$or['2'].effectiveInstant.$gte.toISOString();
            result.query.$and['0'].$or['2'].effectiveInstant.$lte = result.query.$and['0'].$or['2'].effectiveInstant.$lte.toISOString();
            expect(result.query).toStrictEqual({
                $and: [
                    {
                        $or: [
                            {
                                effectiveDateTime: {
                                    $regex: /^(?:2019-10-16T22:12)|(?:2019-10-16T22:12:29)|(?:2019$)|(?:2019-10$)|(?:2019-10-16$)|(?:2019-10-16T22:12Z?$)/,
                                    $options: 'i'
                                }
                            },
                            {
                                'effectiveTiming.event': {
                                    $lte: '2019-10-16T22:12:29+00:00'
                                }
                            },
                            {
                                effectiveInstant: {
                                    $gte: '2019-10-16T00:00:00.000Z',
                                    $lte: '2019-10-16T23:59:59.999Z'
                                }
                            },
                            {
                                'effectivePeriod.start': {
                                    $lte: '2019-10-16T22:12:29+00:00'
                                },
                                'effectivePeriod.end': { $gte: '2019-10-16T22:12:29+00:00' }
                            },
                            {
                                'effectivePeriod.start': { $lte: '2019-10-16T22:12:29+00:00' },
                                'effectivePeriod.end': null
                            },
                            {
                                'effectivePeriod.end': { $gte: '2019-10-16T22:12:29+00:00' },
                                'effectivePeriod.start': null
                            }
                        ]
                    },
                    {
                        'meta.tag': {
                            $not: {
                                $elemMatch: {
                                    system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior',
                                    code: 'hidden'
                                }
                            }
                        }
                    }
                ]
            });
        });
        test.skip('r4 works with date with microseconds in Observation', async () => {
            // TODO: Fix dateQueryBuilder() first
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
                base_version: VERSIONS['4_0_0'],
                date: '2019-10-16T22:12:29.000Z'
            };
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: 'Observation',
                parsedArgs: r4ArgsParser.parseArgs({ resourceType: 'Observation', args })
            });
            expect(result.query).toStrictEqual(
                {
                    $or: [
                        {
                            effectiveDateTime: {
                                $options: 'i',
                                $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/
                            }
                        },
                        {
                            $and: [
                                {
                                    'effectivePeriod.start': {
                                        $lte: '2019-10-16T22:12:29+00:00'
                                    }
                                },
                                {
                                    $or: [
                                        {
                                            'effectivePeriod.end': {
                                                $gte: '2019-10-16T22:12:29+00:00'
                                            }
                                        },
                                        {
                                            'effectivePeriod.end': null
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            effectiveTiming: {
                                $options: 'i',
                                $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/
                            }
                        },
                        {
                            effectiveInstant: {
                                $options: 'i',
                                $regex: /\^\(\?:2019-10-16T22:12\)\|\(\?:2019-10-16T22:12:29\.000Z\)\|\(\?:2019\$\)\|\(\?:2019-10\$\)\|\(\?:2019-10-16\$\)\|\(\?:2019-10-16T22:12Z\?\$\)/
                            }
                        }
                    ]
                });
        });
        test('r4 works with empty parameters', async () => {
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
                base_version: VERSIONS['4_0_0'],
                'address:contains': '',
                'address-city:contains': '',
                'address-country:contains': '',
                'address-postalcode:contains': '',
                'address-state:contains': '',
                'name:contains': '',
                'phonetic:contains': '',
                _lastUpdated: ['', ''],
                given: 'DONOTUSE',
                family: 'HIEMASTERONE',
                email: '',
                _security: '',
                id: '',
                identifier: ['', ''],
                '_source:contains': '',
                _getpagesoffset: '',
                _sort: '',
                _count: '100'

            };
            const resourceType = 'Patient';
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType,
                parsedArgs: r4ArgsParser.parseArgs({ resourceType, args })
            });
            expect(result.query).toStrictEqual(
                {
                    $and: [
                        {
                            'name.given': {
                                $regex: /^DONOTUSE/i
                            }
                        },
                        {
                            'name.family': {
                                $regex: /^HIEMASTERONE/i
                            }
                        },
                        {
                            'meta.tag': {
                                $not: {
                                    $elemMatch: {
                                        code: 'hidden',
                                        system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior'
                                    }
                                }
                            }
                        }
                    ]
                });
        });
    });
});
