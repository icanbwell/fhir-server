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
                base_version: VERSIONS['4_0_0'],
                patient: '7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
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
                base_version: VERSIONS['4_0_0'],
                patient: '1234'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._sourceId': {
                    $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/1234'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/1234|abc'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $and: [
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
                base_version: VERSIONS['4_0_0'],
                patient: '7708d86f-1d3e-4389-a8c6-3a88075934f1,6286dcd1-2e3a-42a3-8f93-41f79f3148fb1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1,Group/6286dcd1-2e3a-42a3-8f93-41f79f3148fb'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._uuid': {
                    $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: '123,456'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._sourceId': {
                    $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/123,Group/456'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                'subject._sourceId': {
                    $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: '123|client,456|client'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $and: [
                    {
                        'subject._sourceAssigningAuthority': 'client'
                    },
                    {
                        'subject._sourceId': {
                            $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/123|client,Group/456|client'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $and: [
                    {
                        'subject._sourceAssigningAuthority': 'client'
                    },
                    {
                        'subject._sourceId': {
                            $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: '123|healthsystem1,456|healthsystem2'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Patient/123',
                                        'Group/123'
                                    ]
                                }
                            }
                        ]
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem2'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Patient/456',
                                        'Group/456'
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/123|healthsystem1,Group/456|healthsystem2'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': 'Patient/123'
                            }
                        ]
                    },
                    {
                        $and: [
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
                base_version: VERSIONS['4_0_0'],
                patient: '123|healthsystem1,456|healthsystem2,789|healthsystem2'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Patient/123',
                                        'Group/123'
                                    ]
                                }
                            }
                        ]
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem2'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Patient/456',
                                        'Group/456',
                                        'Patient/789',
                                        'Group/789'
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/123|healthsystem1,Group/456|healthsystem2,Patient/789|healthsystem2'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': 'Patient/123'
                            }
                        ]
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem2'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Group/456',
                                        'Patient/789'
                                    ]
                                }
                            }
                        ]
                    }
                ]
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
                base_version: VERSIONS['4_0_0'],
                patient: '123,7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        'subject._uuid': {
                            $in: [
                                'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                                'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                            ]
                        }
                    },
                    {
                        'subject._sourceId': {
                            $in: [
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/123,Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
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
                base_version: VERSIONS['4_0_0'],
                patient: '123|client,7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        'subject._uuid': {
                            $in: [
                                'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                                'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                            ]
                        }
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'client'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Patient/123',
                                        'Group/123'
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/123|client,Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        'subject._uuid': 'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'client'
                            },
                            {
                                'subject._sourceId': 'Patient/123'
                            }
                        ]
                    }
                ]
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
                base_version: VERSIONS['4_0_0'],
                patient: '123|healthsystem1,456|healthsystem2,789|healthsystem2,7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        'subject._uuid': {
                            $in: [
                                'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1',
                                'Group/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                            ]
                        }
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Patient/123',
                                        'Group/123'
                                    ]
                                }
                            }
                        ]
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem2'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Patient/456',
                                        'Group/456',
                                        'Patient/789',
                                        'Group/789'
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
                base_version: VERSIONS['4_0_0'],
                patient: 'Patient/123|healthsystem1,Group/456|healthsystem2,Patient/789|healthsystem2,Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1'
            };
            const parsedArgs = r4ArgsParser.parseArgs({ resourceType, args });
            const result = r4SearchQueryCreator.buildR4SearchQuery({
                resourceType, parsedArgs
            });
            expect(result.query).toStrictEqual({
                $or: [
                    {
                        'subject._uuid': 'Patient/7708d86f-1d3e-4389-a8c6-3a88075934f1'
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem1'
                            },
                            {
                                'subject._sourceId': 'Patient/123'
                            }
                        ]
                    },
                    {
                        $and: [
                            {
                                'subject._sourceAssigningAuthority': 'healthsystem2'
                            },
                            {
                                'subject._sourceId': {
                                    $in: [
                                        'Group/456',
                                        'Patient/789'
                                    ]
                                }
                            }
                        ]
                    }
                ]
            });
        });
    });
});
