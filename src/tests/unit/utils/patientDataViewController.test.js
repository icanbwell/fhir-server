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

describe('PatientDataViewControlManager', () => {
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

    describe('getConsentAsync', () => {
        describe('owner gating (the caller passes the Person and its owner)', () => {
            const getConsent = (overrides = {}) => manager.getConsentAsync({
                requestInfo: createRequestInfo('person-123'),
                base_version: '4_0_0',
                personId: 'person-123',
                owner: 'clientA',
                patientFilterReferences: null,
                ...overrides
            });

            test.each([['null', null], ['undefined', undefined], ['empty', '']])(
                'throws when the Person has no owner tag (%s), without a Consent search',
                async (_name, owner) => {
                    await expect(getConsent({ owner })).rejects.toThrow('has no owner tag');
                    expect(mockSearchManager.fetchResourcesByArgsAsync).not.toHaveBeenCalled();
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

                await manager.getConsentAsync({
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
                        patient: 'Patient/person.person-456',
                        category: `${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM}|${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.CODE}`
                    })
                });
            });

            test('includes actor when patientFilterReferences provided', async () => {

                await manager.getConsentAsync({
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

                await manager.getConsentAsync({
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

                await manager.getConsentAsync({
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

                const result = await manager.getConsentAsync({
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

                const result = await manager.getConsentAsync({
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

                const result = await manager.getConsentAsync({
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

                const result = await manager.getConsentAsync({
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

                const result = await manager.getConsentAsync({
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

                const result = await manager.getConsentAsync({
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

    describe('findPersonAsync', () => {
        const personEntry = (security) => ({ resource: { resourceType: 'Person', _uuid: 'person-uuid-1', meta: { security } } });
        const OWNER = { system: 'https://www.icanbwell.com/owner', code: 'clientA' };
        const ACCESS = { system: 'https://www.icanbwell.com/access', code: 'clientA' };

        test('reads the Person through the caller\'s access filter and returns its uuid and owner', async () => {
            mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({ entries: [personEntry([ACCESS, OWNER])] });
            const requestInfo = createRequestInfo(undefined, { isUser: false, scope: 'user/*.read access/clientA.read' });

            const result = await manager.findPersonAsync({ requestInfo, base_version: '4_0_0', personId: 'person-1' });

            expect(result).toEqual({ uuid: 'person-uuid-1', owner: 'clientA' });
            expect(mockSearchManager.fetchResourcesByArgsAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Person', requestInfo })
            );
            expect(mockR4ArgsParser.parseArgs).toHaveBeenCalledWith({
                resourceType: 'Person',
                args: { base_version: '4_0_0', _id: 'person-1' }
            });
        });

        test('returns no owner for a Person without an owner tag (the consent lookup then fails)', async () => {
            mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({ entries: [personEntry([ACCESS])] });
            const result = await manager.findPersonAsync({
                requestInfo: createRequestInfo(undefined, { isUser: false }), base_version: '4_0_0', personId: 'person-1'
            });
            expect(result.owner).toBeUndefined();
        });

        // statusCode, not instanceof: ServerError resets the prototype, so subclasses aren't instanceof-detectable
        test('a Person the caller cannot see (or that does not exist) is a 404', async () => {
            mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({ entries: [] });
            await expect(manager.findPersonAsync({
                requestInfo: createRequestInfo(undefined, { isUser: false }), base_version: '4_0_0', personId: 'person-1'
            })).rejects.toMatchObject({ statusCode: 404, message: 'Person not found' });
        });

        test('an id matching more than one visible Person is a 400', async () => {
            mockSearchManager.fetchResourcesByArgsAsync.mockResolvedValue({
                entries: [personEntry([OWNER]), personEntry([OWNER])]
            });
            await expect(manager.findPersonAsync({
                requestInfo: createRequestInfo(undefined, { isUser: false }), base_version: '4_0_0', personId: 'person-1'
            })).rejects.toMatchObject({ statusCode: 400 });
        });
    });
});
