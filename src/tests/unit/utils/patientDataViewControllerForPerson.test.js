const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

const { PatientDataViewControlManager } = require('../../../utils/patientDataViewController');
const { ConfigManager } = require('../../../utils/configManager');
const { SearchManager } = require('../../../operations/search/searchManager');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { CONSENT_CATEGORY } = require('../../../constants');


// Helper to create mock instances that pass assertTypeEquals
function createMockConfigManager(overrides = {}) {
    const instance = Object.create(ConfigManager.prototype);
    Object.defineProperty(instance, 'clientsWithDataConnectionViewControl', {
        get: () => overrides.clientsWithDataConnectionViewControl || [],
        configurable: true
    });
    return instance;
}

function createMockSearchManager() {
    const instance = Object.create(SearchManager.prototype);
    instance.fetchResourcesByArgsAsync = jest.fn().mockResolvedValue({
        entries: [],
        queryItems: [],
        options: []
    });
    return instance;
}

function createMockR4ArgsParser() {
    const instance = Object.create(R4ArgsParser.prototype);
    instance.parseArgs = jest.fn().mockReturnValue({ parsedArgItems: [] });
    return instance;
}

function createRequestInfo(personId, overrides = {}) {
    return {
        personIdFromJwtToken: personId,
        user: overrides.user || 'test-user',
        scope: overrides.scope || 'patient/*.*',
        isUser: overrides.isUser !== undefined ? overrides.isUser : true,
        userType: overrides.userType || 'user',
        requestId: overrides.requestId || 'req-123',
        ...overrides
    };
}

describe('PatientDataViewControlManager.getConsentForPersonAsync', () => {
    let manager;
    let mockConfigManager;
    let mockSearchManager;
    let mockR4ArgsParser;

    beforeEach(() => {
        jest.clearAllMocks();

        mockConfigManager = createMockConfigManager({
            clientsWithDataConnectionViewControl: ['clientA', 'clientB']
        });
        mockSearchManager = createMockSearchManager();
        mockR4ArgsParser = createMockR4ArgsParser();

        manager = new PatientDataViewControlManager({
            configManager: mockConfigManager,
            searchManager: mockSearchManager,
            r4ArgsParser: mockR4ArgsParser
        });
    });

    describe('getConsentForPersonAsync', () => {
        describe('owner gating (the caller passes the Person and its owner)', () => {
            const getConsent = (overrides = {}) => manager.getConsentForPersonAsync({
                requestInfo: createRequestInfo('person-123'),
                base_version: '4_0_0',
                personId: 'person-123',
                owner: 'clientA',
                patientFilterReferences: null,
                ...overrides
            });

            test.each([['null', null], ['undefined', undefined], ['empty', '']])(
                'treats a Person with no owner tag (%s) as enrolled: the Consent is searched, not failed',
                async (_name, owner) => {
                    await getConsent({ owner });
                    expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledTimes(1);
                }
            );

            test('throws when no personId is passed', async () => {
                await expect(getConsent({ personId: undefined })).rejects.toThrow('personId is required');
            });

            test('returns an empty result without a Consent search when the owner is not enrolled', async () => {
                const result = await getConsent({ owner: 'clientC' });
                expect(result).toEqual({
                    viewControlResourceToExcludeMap: {},
                    viewControlConsentQueries: [],
                    viewControlConsentQueryOptions: []
                });
                expect(mockSearchManager.fetchResourcesByArgsAsync).not.toHaveBeenCalled();
            });

            test('searches the Consent when the owner is enrolled', async () => {
                await getConsent();
                expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledTimes(1);
            });
        });

        describe('search parameters construction', () => {
            test('constructs correct consent args with personId', async () => {

                await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-456'),
                    personId: 'person-456',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith({
                    resourceType: 'Consent',
                    args: expect.objectContaining({
                        base_version: '4_0_0',
                        status: 'active',
                        patient: 'Patient/person.person-456',
                        category: `${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM}|${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.CODE}`
                    })
                });
            });

            test('includes actor when patientFilterReferences provided', async () => {

                await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-456'),
                    personId: 'person-456',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: ['Patient/pat-1', 'Patient/pat-2']
                });

                expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith({
                    resourceType: 'Consent',
                    args: expect.objectContaining({
                        actor: 'Patient/pat-1,Patient/pat-2'
                    })
                });
            });

            test('does NOT include actor when patientFilterReferences is null', async () => {

                await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-456'),
                    personId: 'person-456',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                const parsedCall = mockR4ArgsParser.parseArgs.mock.calls[0][0];
                expect(parsedCall.args.actor).toBeUndefined();
            });

            test('does NOT include actor when patientFilterReferences is empty array', async () => {

                await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-456'),
                    personId: 'person-456',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: []
                });

                const parsedCall = mockR4ArgsParser.parseArgs.mock.calls[0][0];
                expect(parsedCall.args.actor).toBeUndefined();
            });
        });

        describe('consent entry processing', () => {
            test('builds viewControlResourceToExcludeMap from consent entries (0 entries)', async () => {
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [],
                    queryItems: ['query1'],
                    options: ['opt1']
                });

                const result = await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-123'),
                    personId: 'person-123',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({});
                expect(result.viewControlConsentQueries).toEqual(['query1']);
                expect(result.viewControlConsentQueryOptions).toEqual(['opt1']);
            });

            test('extracts resource types and ids from consent provision data (1 entry)', async () => {
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {
                            provision: {
                                data: [{
                                    reference: {
                                        reference: 'Observation/obs-1'
                                    }
                                }]
                            }
                        }
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-123'),
                    personId: 'person-123',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({
                    Observation: ['obs-1']
                });
            });

            test.each([
                ['constructor/1', 'constructor'],
                ['toString/1', 'toString'],
                ['__proto__/1', '__proto__']
            ])('keeps a reference whose type is an Object.prototype name (%s) as an ordinary key', async (reference, type) => {
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {
                            provision: {
                                data: [
                                    { reference: { reference } },
                                    { reference: { reference: 'Observation/obs-1' } }
                                ]
                            }
                        }
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-123'),
                    personId: 'person-123',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                const map = result.viewControlResourceToExcludeMap;
                expect(Object.keys(map).sort()).toEqual([type, 'Observation'].sort());
                expect(map[type]).toEqual(['1']);
                expect(map.Observation).toEqual(['obs-1']);
            });

            test('groups multiple references by resource type (>1 entries)', async () => {
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [
                        {
                            resource: {
                                provision: {
                                    data: [
                                        { reference: { reference: 'Observation/obs-1' } },
                                        { reference: { reference: 'Observation/obs-2' } },
                                        { reference: { reference: 'Condition/cond-1' } }
                                    ]
                                }
                            }
                        },
                        {
                            resource: {
                                provision: {
                                    data: [
                                        { reference: { reference: 'Observation/obs-3' } }
                                    ]
                                }
                            }
                        }
                    ],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-123'),
                    personId: 'person-123',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({
                    Observation: ['obs-1', 'obs-2', 'obs-3'],
                    Condition: ['cond-1']
                });
            });

            test('handles consent entry with no provision', async () => {
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {}
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-123'),
                    personId: 'person-123',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({});
            });

            test('handles consent entry with provision but no data', async () => {
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {
                            provision: {}
                        }
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-123'),
                    personId: 'person-123',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({});
            });

            test('skips data entries with no reference.reference', async () => {
                mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                    entries: [{
                        resource: {
                            provision: {
                                data: [
                                    { reference: {} },  // no reference field
                                    { reference: { reference: 'Observation/obs-1' } }, // valid
                                    { }  // no reference object at all
                                ]
                            }
                        }
                    }],
                    queryItems: [],
                    options: []
                });

                const result = await manager.getConsentForPersonAsync({
                    requestInfo: createRequestInfo('person-123'),
                    personId: 'person-123',
                    owner: 'clientA',
                    base_version: '4_0_0',
                    patientFilterReferences: null
                });

                expect(result.viewControlResourceToExcludeMap).toEqual({
                    Observation: ['obs-1']
                });
            });
        });
    });
});
