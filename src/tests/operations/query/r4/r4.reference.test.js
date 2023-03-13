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

    describe('r4 search single id Tests', () => {
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
        test('single uuid reference with resourceType', async () => {
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
                'patient': 'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': 'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            });
        });
        test('single id reference without resourceType and sourceAssigningAuthority', async () => {
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
                'patient': '1234'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._sourceId': {
                    '$in': [
                        'Patient/1234',
                        'Group/1234'
                    ]
                }
            });
        });
        test('single id reference with resourceType but no sourceAssigningAuthority', async () => {
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
                'patient': 'Patient/1234'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._sourceId': 'Patient/1234'
            });
        });
        test('single id reference with resourceType and sourceAssigningAuthority', async () => {
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
                'patient': 'Patient/1234|abc'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$and': [
                    {
                        'subject._sourceAssigningAuthority': 'abc'
                    },
                    {
                        'subject._sourceId': 'Patient/1234'
                    }
                ]
            });
        });
    });
    describe('r4 search multiple id Tests', () => {
        test('multiple uuid reference without resourceType', async () => {
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
                'patient': '7708d86f-1d3e-4389-a8c6-3a88075934f1,2b383507-dffb-4ab2-9e41-d6f64efa56c1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    '$in': [
                        'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                        'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                        'Patient/2b383507-dffb-4ab2-9e41-d6f64efa56c1',
                        'Group/2b383507-dffb-4ab2-9e41-d6f64efa56c1'
                    ]
                }
            });
        });
        test('multiple uuid reference with resourceType', async () => {
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
                'patient': 'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1,Group/2b383507-dffb-4ab2-9e41-d6f64efa56c'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    '$in': [
                        'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                        'Group/2b383507-dffb-4ab2-9e41-d6f64efa56c'
                    ]
                }
            });
        });
        test('multiple id reference without resourceType and without sourceAssigningAuthority', async () => {
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
                'patient': '123,456'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._sourceid': {
                    '$in': [
                        'Patient/123',
                        'Group/123',
                        'Patient/456',
                        'Group/456'
                    ]
                }
            });
        });
        test('multiple id reference with resourceType and without sourceAssigningAuthority', async () => {
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
                'patient': 'Patient/123,Group/456'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._sourceid': {
                    '$in': [
                        'Patient/123',
                        'Group/456'
                    ]
                }
            });
        });
        test('multiple id reference without resourceType and with same sourceAssigningAuthority', async () => {
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
                'patient': '123|medstar,456|medstar'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$and': [
                    {
                        'subject._sourceAssigningAuthority': 'medstar'
                    },
                    {
                        'subject._sourceid': {
                            '$in': [
                                'Patient/123',
                                'Patient/456',
                                'Group/123',
                                'Group/456'
                            ]
                        }
                    }
                ]
            });
        });
        test('multiple id reference with resourceType and with same sourceAssigningAuthority', async () => {
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
                'patient': 'Patient/123|medstar,Group/456|medstar'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$and': [
                    {
                        'subject._sourceAssigningAuthority': 'medstar'
                    },
                    {
                        'subject._sourceid': {
                            '$in': [
                                'Patient/123',
                                'Group/456'
                            ]
                        }
                    }
                ]
            });
        });
        test('multiple id reference without resourceType and with different sourceAssigningAuthority', async () => {
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
                'patient': '123|healthsystem1,456|healthsystem2'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {
                        '$and': [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': {
                                    '$in': [
                                        'Patient/123',
                                        'Patient/456',
                                    ]
                                }
                            }
                        ]
                    },
                    {
                        '$and': [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem2'
                            },
                            {
                                'subject._sourceId': {
                                    '$in': [
                                        'Group/123',
                                        'Group/456',
                                    ]
                                }
                            }
                        ]
                    }
                ]
            });
        });
        test('multiple id reference with resourceType and with different sourceAssigningAuthority', async () => {
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
                'patient': 'Patient/123|healthsystem1,Group/456|healthsystem2'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {
                        '$and': [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': 'Patient/123'
                            }
                        ]
                    },
                    {
                        '$and': [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem2'
                            },
                            {
                                'subject._sourceId': 'Group/456'
                            }
                        ]
                    }
                ]
            });
        });
    });
});
