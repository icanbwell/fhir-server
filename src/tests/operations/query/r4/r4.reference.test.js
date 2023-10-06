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
                'subject._uuid': 'Patient/fb37c777-bfde-548e-8500-497f17e31499',
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
                'patient': '7708d86f-1d3e-4389-a8c6-3a88075934f1,6286dcd1-2e3a-42a3-8f93-41f79f3148fb1'
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
                        'Patient/6286dcd1-2e3a-42a3-8f93-41f79f3148fb1',
                        'Group/6286dcd1-2e3a-42a3-8f93-41f79f3148fb1'
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
                'patient': 'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1,Group/6286dcd1-2e3a-42a3-8f93-41f79f3148fb'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    '$in': [
                        'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                        'Group/6286dcd1-2e3a-42a3-8f93-41f79f3148fb'
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
                'subject._sourceId': {
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
                'subject._sourceId': {
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
                        'subject._sourceId': {
                            '$in': [
                                'Patient/123',
                                'Group/123',
                                'Patient/456',
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
            expect(result.query).toStrictEqual(
                    {
                        'subject._uuid': {
                            '$in': [
                                'Patient/75410ead-86b3-5f2c-8759-493356176560',
                                'Group/9c3b9963-2e16-55de-a993-c3de1103d0a8',
                            ]
                        }
                    }
            );
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
                                        'Group/123',
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
                                        'Patient/456',
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
                'subject._uuid': {
                    '$in': [
                        'Patient/73e3235f-e3cd-586f-85a6-9872386b672c',
                        'Group/ae3669df-9cc5-5f76-a94e-17097b323c8a',
                    ]
                }
            });
        });
        test('multiple id reference without resourceType and with same & different sourceAssigningAuthority', async () => {
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
                'patient': '123|healthsystem1,456|healthsystem2,789|healthsystem2'
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
                                        'Group/123'
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
                                        'Patient/456',
                                        'Group/456',
                                        'Patient/789',
                                        'Group/789',
                                    ]
                                }
                            }
                        ]
                    }
                ]
            });
        });
        test('multiple id reference with resourceType and with same & different sourceAssigningAuthority', async () => {
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
                'patient': 'Patient/123|healthsystem1,Group/456|healthsystem2,Patient/789|healthsystem2'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    '$in': [
                        'Patient/73e3235f-e3cd-586f-85a6-9872386b672c',
                        'Group/ae3669df-9cc5-5f76-a94e-17097b323c8a',
                        'Patient/8da4bf65-d7e4-50c7-a0b0-13572a1ddaee',
                    ]
                }
            });
        });
    });
    describe('r4 search mix id and uuid Tests', () => {
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
                'patient': '123,7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {
                        'subject._uuid': {
                            '$in': [
                                'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                                'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                            ]
                        }
                    },
                    {
                        'subject._sourceId': {
                            '$in': [
                                'Patient/123',
                                'Group/123'
                            ]
                        }
                    }
                ]
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
                'patient': 'Patient/123,Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {
                        'subject._uuid': 'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                    },
                    {
                        'subject._sourceId': 'Patient/123'
                    }
                ]
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
                'patient': '123|medstar,7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {
                        'subject._uuid': {
                            '$in': [
                                'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                                'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                            ]
                        }
                    },
                    {
                        '$and': [
                            {
                                'subject._sourceAssigningAuthority': 'medstar'
                            },
                            {
                                'subject._sourceId': {
                                    '$in': [
                                        'Patient/123',
                                        'Group/123',
                                    ]
                                }
                            }
                        ]
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
                'patient': 'Patient/123|medstar,Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    '$in': [
                        'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                        'Patient/75410ead-86b3-5f2c-8759-493356176560',
                        ]
                }
            });
        });
        test('multiple id reference without resourceType and with same & different sourceAssigningAuthority', async () => {
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
                'patient': '123|healthsystem1,456|healthsystem2,789|healthsystem2,7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {
                        'subject._uuid': {
                            '$in': [
                                'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                                'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                            ]
                        }
                    },
                    {
                        '$and': [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': {
                                    '$in': [
                                        'Patient/123',
                                        'Group/123'
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
                                        'Patient/456',
                                        'Group/456',
                                        'Patient/789',
                                        'Group/789',
                                    ]
                                }
                            }
                        ]
                    }
                ]
            });
        });
        test('multiple id reference with resourceType and with same & different sourceAssigningAuthority', async () => {
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
                'patient': 'Patient/123|healthsystem1,Group/456|healthsystem2,Patient/789|healthsystem2,Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({resourceType: resourceType, args});
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType: resourceType, parsedArgs: parsedArgs
            });
            expect(result.query).toStrictEqual({
                '$or': [
                    {'subject._uuid': 'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',},
                    {'subject._uuid': {
                   '$in': [
                       'Patient/73e3235f-e3cd-586f-85a6-9872386b672c',
                       'Group/ae3669df-9cc5-5f76-a94e-17097b323c8a',
                       'Patient/8da4bf65-d7e4-50c7-a0b0-13572a1ddaee',
                   ]
                 }}
                ]
            });
        });
    });
});
