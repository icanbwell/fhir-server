const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');
const nock = require('nock');

const { PersonMatchManager } = require('../../../admin/personMatchManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../utils/configManager');
const { OAuthClientCredentialsHelper } = require('../../../utils/oauthClientCredentialsHelper');
const { AuditLogger } = require('../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');

function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('PersonMatchManager', () => {
    let personMatchManager;
    let mockDatabaseQueryFactory;
    let mockConfigManager;
    let mockOAuthHelper;
    let mockAuditLogger;
    let mockPostRequestProcessor;
    let mockRequestSpecificCache;

    const MATCH_SERVICE_URL = 'http://match-service.example.com/match';

    beforeEach(() => {
        nock.cleanAll();

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);

        mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'personMatchingServiceUrl', { get: () => MATCH_SERVICE_URL });
        Object.defineProperty(mockConfigManager, 'requestTimeoutMs', { get: () => ({ response: 30000, deadline: 60000 }) });

        mockOAuthHelper = createMockInstance(OAuthClientCredentialsHelper);
        mockOAuthHelper.getAccessTokenAsync = jestGlobal.fn().mockResolvedValue('mock-access-token');

        mockAuditLogger = createMockInstance(AuditLogger);
        mockAuditLogger.logAuditEntryAsync = jestGlobal.fn().mockResolvedValue(undefined);

        mockPostRequestProcessor = createMockInstance(PostRequestProcessor);
        mockPostRequestProcessor.add = jestGlobal.fn();
        mockPostRequestProcessor.executeAsync = jestGlobal.fn().mockResolvedValue(undefined);

        mockRequestSpecificCache = createMockInstance(RequestSpecificCache);
        mockRequestSpecificCache.clearAsync = jestGlobal.fn().mockResolvedValue(undefined);

        personMatchManager = new PersonMatchManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            configManager: mockConfigManager,
            oauthClientCredentialsHelper: mockOAuthHelper,
            auditLogger: mockAuditLogger,
            postRequestProcessor: mockPostRequestProcessor,
            requestSpecificCache: mockRequestSpecificCache
        });
    });

    afterEach(() => {
        nock.cleanAll();
    });

    describe('personMatchAsync', () => {
        function setupDbMock ({ sourceResults, targetResults }) {
            const mockSourceCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(sourceResults.length > 0)
                    .mockResolvedValue(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(sourceResults[0])
            };
            const mockTargetCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(targetResults.length > 0)
                    .mockResolvedValue(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(targetResults[0])
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn()
                    .mockResolvedValueOnce(mockSourceCursor)
                    .mockResolvedValueOnce(mockTargetCursor)
            });
        }

        test('returns not-found when source not found', async () => {
            setupDbMock({ sourceResults: [], targetResults: [] });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'not-found',
                targetId: 'also-not-found'
            });

            expect(result.issue).toBeDefined();
            expect(result.issue[0].code).toBe('not-found');
            expect(result.issue[0].diagnostics).toContain('not-found');
        });

        test('returns not-found when target not found', async () => {
            const sourceResource = {
                _uuid: 'src-uuid',
                id: 'src-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'src-1' })
            };
            setupDbMock({ sourceResults: [sourceResource], targetResults: [] });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'not-found'
            });

            expect(result.issue).toBeDefined();
            expect(result.issue[0].code).toBe('not-found');
            expect(result.issue[0].diagnostics).toContain('not-found');
        });

        test('strips resourceType prefix from sourceId', async () => {
            const sourceResource = {
                _uuid: 'src-uuid',
                id: 'src-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'src-1' })
            };
            const targetResource = {
                _uuid: 'tgt-uuid',
                id: 'tgt-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'tgt-1' })
            };

            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(sourceResource)
            };
            const mockCursor2 = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(targetResource)
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn()
                    .mockResolvedValueOnce(mockCursor)
                    .mockResolvedValueOnce(mockCursor2)
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [{ search: { score: 0.9 } }] });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'Patient/src-1',
                targetId: 'Patient/tgt-1'
            });

            expect(result.entry).toBeDefined();
            expect(result.entry[0].search.score).toBe(0.9);
        });

        test('converts Date birthDate to string format', async () => {
            const sourceResource = {
                _uuid: 'src-uuid',
                id: 'src-1',
                birthDate: new Date('1990-05-15'),
                toJSON: () => ({ resourceType: 'Patient', id: 'src-1', birthDate: '1990-05-15' })
            };
            const targetResource = {
                _uuid: 'tgt-uuid',
                id: 'tgt-1',
                birthDate: new Date('1985-03-20'),
                toJSON: () => ({ resourceType: 'Patient', id: 'tgt-1', birthDate: '1985-03-20' })
            };

            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(sourceResource)
            };
            const mockCursor2 = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(targetResource)
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn()
                    .mockResolvedValueOnce(mockCursor)
                    .mockResolvedValueOnce(mockCursor2)
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [{ search: { score: 0.85 } }] });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1'
            });

            expect(sourceResource.birthDate).toBe('1990-05-15');
            expect(targetResource.birthDate).toBe('1985-03-20');
            expect(result.entry[0].search.score).toBe(0.85);
        });

        test('returns error for multiple source resources', async () => {
            const sourceResource1 = {
                _uuid: 'src-uuid-1',
                id: 'src-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'src-1' })
            };
            const sourceResource2 = {
                _uuid: 'src-uuid-2',
                id: 'src-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'src-1' })
            };
            const targetResource = {
                _uuid: 'tgt-uuid',
                id: 'tgt-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'tgt-1' })
            };

            // Both source and target are Patient type, so both use the Patient query manager
            // createQuery is called twice: once for Patient, once for Person
            // source uses patientDatabaseQueryManager, target uses patientDatabaseQueryManager
            const mockSourceCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn()
                    .mockResolvedValueOnce(sourceResource1)
                    .mockResolvedValueOnce(sourceResource2)
            };
            const mockTargetCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn()
                    .mockResolvedValueOnce(targetResource)
            };

            // patientDatabaseQueryManager is created first, personDatabaseQueryManager second
            const patientQueryManager = {
                findAsync: jestGlobal.fn()
                    .mockResolvedValueOnce(mockSourceCursor)
                    .mockResolvedValueOnce(mockTargetCursor)
            };
            const personQueryManager = {
                findAsync: jestGlobal.fn()
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(patientQueryManager)
                .mockReturnValueOnce(personQueryManager);

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1'
            });

            expect(result.issue).toBeDefined();
            expect(result.issue[0].code).toBe('info');
            expect(result.issue[0].diagnostics).toContain('Multiple resources');
        });

        test('returns match with includeMatchRequest', async () => {
            const sourceResource = {
                _uuid: 'src-uuid',
                id: 'src-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'src-1' })
            };
            const targetResource = {
                _uuid: 'tgt-uuid',
                id: 'tgt-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'tgt-1' })
            };

            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(sourceResource)
            };
            const mockCursor2 = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                nextObject: jestGlobal.fn().mockResolvedValueOnce(targetResource)
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn()
                    .mockResolvedValueOnce(mockCursor)
                    .mockResolvedValueOnce(mockCursor2)
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [{ search: { score: 0.99 } }] });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1',
                includeMatchRequest: true
            });

            expect(result.matchRequest).toBeDefined();
            expect(result.matchResponse).toBeDefined();
            expect(result.matchRequest.resourceType).toBe('Parameters');
        });
    });

    describe('_extractDemographics', () => {
        test('extracts name, gender, birthDate, telecom, address', () => {
            const resource = {
                name: [{ family: 'Smith' }],
                gender: 'female',
                birthDate: '1990-01-01',
                telecom: [{ system: 'phone', value: '555-1234' }],
                address: [{ city: 'NY' }],
                id: 'should-not-include',
                meta: { source: 'should-not-include' }
            };

            const result = personMatchManager._extractDemographics(resource);
            expect(result.name).toEqual([{ family: 'Smith' }]);
            expect(result.gender).toBe('female');
            expect(result.birthDate).toBe('1990-01-01');
            expect(result.telecom).toBeDefined();
            expect(result.address).toBeDefined();
            expect(result.id).toBeUndefined();
            expect(result.meta).toBeUndefined();
        });

        test('converts Date birthDate to string', () => {
            const resource = { birthDate: new Date('1990-05-15T00:00:00Z') };
            const result = personMatchManager._extractDemographics(resource);
            expect(result.birthDate).toBe('1990-05-15');
        });

        test('returns empty object when no demographic fields', () => {
            const resource = { id: 'test', meta: {} };
            const result = personMatchManager._extractDemographics(resource);
            expect(Object.keys(result).length).toBe(0);
        });
    });

    describe('runMatchWithPayloadAsync', () => {
        test('returns error when parameters is null', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({ parameters: null });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('resourceType must be "Parameters"');
        });

        test('returns error when resourceType is not Parameters', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({
                parameters: { resourceType: 'Patient', parameter: [] }
            });
            expect(result.issue).toBeDefined();
        });

        test('returns error when parameter array is empty', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({
                parameters: { resourceType: 'Parameters', parameter: [] }
            });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('non-empty array');
        });

        test('sends payload to match service', async () => {
            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [{ search: { score: 0.88 } }] });

            const parameters = {
                resourceType: 'Parameters',
                parameter: [{ name: 'resource', resource: { resourceType: 'Patient' } }]
            };

            const result = await personMatchManager.runMatchWithPayloadAsync({ parameters });
            expect(result.entry[0].search.score).toBe(0.88);
        });
    });

    describe('personOneToNMatchAsync', () => {
        test('returns error for invalid resourceType', async () => {
            const result = await personMatchManager.personOneToNMatchAsync({
                id: 'some-id',
                resourceType: 'Observation',
                requestInfo: { requestId: 'req-1' }
            });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('must be "Patient" or "Person"');
        });

        test('returns error for invalid matchResourceType', async () => {
            const result = await personMatchManager.personOneToNMatchAsync({
                id: 'some-id',
                resourceType: 'Patient',
                matchResourceType: 'Observation',
                requestInfo: { requestId: 'req-1' }
            });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('matchResourceType');
        });

        test('returns not-found when resource does not exist', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                nextObject: jestGlobal.fn()
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            const result = await personMatchManager.personOneToNMatchAsync({
                id: 'nonexistent',
                resourceType: 'Patient',
                requestInfo: { requestId: 'req-1' }
            });
            expect(result.issue[0].code).toBe('not-found');
        });
    });
});
