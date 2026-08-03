const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');
const nock = require('nock');

jestGlobal.mock('../../../utils/assertType', () => {
    const { jest: j } = require('@jest/globals');
    return {
        assertTypeEquals: j.fn(),
        assertIsValid: j.fn((val, msg) => {
            if (!val) throw new Error(msg);
        })
    };
});

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
            const sourceIdx = { current: 0 };
            const targetIdx = { current: 0 };
            const mockSourceCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(sourceIdx.current < sourceResults.length)),
                nextObject: jestGlobal.fn(() => {
                    const result = sourceResults[sourceIdx.current];
                    sourceIdx.current++;
                    return Promise.resolve(result);
                })
            };
            const mockTargetCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(targetIdx.current < targetResults.length)),
                nextObject: jestGlobal.fn(() => {
                    const result = targetResults[targetIdx.current];
                    targetIdx.current++;
                    return Promise.resolve(result);
                })
            };

            // createQuery is called twice: once for Patient, once for Person
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
        }

        function setupDbMockWithSeparateCursors ({ sourceResults, targetResults, sourceType = 'Patient', targetType = 'Patient' }) {
            const sourceIdx = { current: 0 };
            const targetIdx = { current: 0 };
            const mockSourceCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(sourceIdx.current < sourceResults.length)),
                nextObject: jestGlobal.fn(() => {
                    const result = sourceResults[sourceIdx.current];
                    sourceIdx.current++;
                    return Promise.resolve(result);
                })
            };
            const mockTargetCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(targetIdx.current < targetResults.length)),
                nextObject: jestGlobal.fn(() => {
                    const result = targetResults[targetIdx.current];
                    targetIdx.current++;
                    return Promise.resolve(result);
                })
            };

            const patientQueryManager = {
                findAsync: jestGlobal.fn()
            };
            const personQueryManager = {
                findAsync: jestGlobal.fn()
            };

            // Both source and target are Patient by default
            if (sourceType === 'Patient') {
                patientQueryManager.findAsync.mockResolvedValueOnce(mockSourceCursor);
            } else {
                personQueryManager.findAsync.mockResolvedValueOnce(mockSourceCursor);
            }
            if (targetType === 'Patient') {
                patientQueryManager.findAsync.mockResolvedValueOnce(mockTargetCursor);
            } else {
                personQueryManager.findAsync.mockResolvedValueOnce(mockTargetCursor);
            }

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(patientQueryManager)
                .mockReturnValueOnce(personQueryManager);
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource1, sourceResource2],
                targetResults: [targetResource]
            });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1'
            });

            expect(result.issue).toBeDefined();
            expect(result.issue[0].code).toBe('info');
            expect(result.issue[0].diagnostics).toContain('Multiple resources');
        });

        test('returns error for multiple target resources', async () => {
            const sourceResource = {
                _uuid: 'src-uuid',
                id: 'src-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'src-1' })
            };
            const targetResource1 = {
                _uuid: 'tgt-uuid-1',
                id: 'tgt-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'tgt-1' })
            };
            const targetResource2 = {
                _uuid: 'tgt-uuid-2',
                id: 'tgt-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'tgt-1' })
            };

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource1, targetResource2]
            });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1'
            });

            expect(result.issue).toBeDefined();
            expect(result.issue[0].code).toBe('info');
            expect(result.issue[0].diagnostics).toContain('Multiple resources');
            expect(result.issue[0].diagnostics).toContain('tgt-1');
        });

        test('returns match result without includeMatchRequest', async () => {
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [{ search: { score: 0.95 } }] });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1',
                includeMatchRequest: false
            });

            expect(result.entry).toBeDefined();
            expect(result.matchRequest).toBeUndefined();
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
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
            expect(result.matchRequest.parameter).toHaveLength(2);
            expect(result.matchRequest.parameter[0].name).toBe('resource');
            expect(result.matchRequest.parameter[1].name).toBe('match');
        });

        test('adds audit entries when requestId is present', async () => {
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [] });

            await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1',
                requestInfo: { requestId: 'req-123' }
            });

            expect(mockPostRequestProcessor.add).toHaveBeenCalledWith(expect.objectContaining({
                requestId: 'req-123'
            }));
            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledWith({ requestId: 'req-123' });
            expect(mockRequestSpecificCache.clearAsync).toHaveBeenCalledWith({ requestId: 'req-123' });
        });

        test('does not add audit entries when requestInfo is absent', async () => {
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [] });

            await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1'
            });

            expect(mockPostRequestProcessor.add).not.toHaveBeenCalled();
            expect(mockPostRequestProcessor.executeAsync).not.toHaveBeenCalled();
        });

        test('returns timeout OperationOutcome on request timeout', async () => {
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
            });

            nock('http://match-service.example.com')
                .post('/match')
                .replyWithError({ message: 'Timeout', code: 'ECONNABORTED' });

            // Simulate timeout error
            const timeoutError = new Error('Timeout');
            timeoutError.timeout = true;
            nock.cleanAll();
            nock('http://match-service.example.com')
                .post('/match')
                .replyWithError(timeoutError);

            // Since nock doesn't properly set timeout flag, mock superagent directly
            const superagent = require('superagent');
            const originalPost = superagent.post;
            superagent.post = jestGlobal.fn().mockReturnValue({
                send: jestGlobal.fn().mockReturnThis(),
                set: jestGlobal.fn().mockReturnThis(),
                retry: jestGlobal.fn().mockReturnThis(),
                timeout: jestGlobal.fn().mockRejectedValue(Object.assign(new Error('timeout'), { timeout: true }))
            });

            try {
                const result = await personMatchManager.personMatchAsync({
                    sourceId: 'src-1',
                    targetId: 'tgt-1'
                });

                expect(result.issue).toBeDefined();
                expect(result.issue[0].code).toBe('timeout');
            } finally {
                superagent.post = originalPost;
            }
        });

        test('throws non-timeout errors', async () => {
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
            });

            const superagent = require('superagent');
            const originalPost = superagent.post;
            superagent.post = jestGlobal.fn().mockReturnValue({
                send: jestGlobal.fn().mockReturnThis(),
                set: jestGlobal.fn().mockReturnThis(),
                retry: jestGlobal.fn().mockReturnThis(),
                timeout: jestGlobal.fn().mockRejectedValue(new Error('Server error'))
            });

            try {
                await expect(personMatchManager.personMatchAsync({
                    sourceId: 'src-1',
                    targetId: 'tgt-1'
                })).rejects.toThrow('Server error');
            } finally {
                superagent.post = originalPost;
            }
        });

        test('uses Person query manager when sourceType is Person', async () => {
            const sourceResource = {
                _uuid: 'src-uuid',
                id: 'src-1',
                toJSON: () => ({ resourceType: 'Person', id: 'src-1' })
            };
            const targetResource = {
                _uuid: 'tgt-uuid',
                id: 'tgt-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'tgt-1' })
            };

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource],
                sourceType: 'Person',
                targetType: 'Patient'
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [] });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'Person/src-1',
                targetId: 'tgt-1'
            });

            expect(result.entry).toBeDefined();
        });

        test('defaults sourceType and targetType to Patient', async () => {
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

            setupDbMockWithSeparateCursors({
                sourceResults: [sourceResource],
                targetResults: [targetResource]
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [] });

            const result = await personMatchManager.personMatchAsync({
                sourceId: 'src-1',
                targetId: 'tgt-1'
            });

            expect(result.entry).toBeDefined();
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

        test('does not include fields that are undefined/null', () => {
            const resource = { name: undefined, gender: null, birthDate: '' };
            const result = personMatchManager._extractDemographics(resource);
            expect(result.name).toBeUndefined();
            expect(result.gender).toBeUndefined();
            expect(result.birthDate).toBeUndefined();
        });

        test('includes only present fields', () => {
            const resource = { gender: 'male' };
            const result = personMatchManager._extractDemographics(resource);
            expect(result).toEqual({ gender: 'male' });
        });
    });

    describe('runMatchWithPayloadAsync', () => {
        test('returns error when parameters is null', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({ parameters: null });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('resourceType must be "Parameters"');
        });

        test('returns error when parameters is undefined', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({ parameters: undefined });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('resourceType must be "Parameters"');
        });

        test('returns error when resourceType is not Parameters', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({
                parameters: { resourceType: 'Patient', parameter: [{ name: 'resource' }] }
            });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('resourceType must be "Parameters"');
        });

        test('returns error when parameter array is empty', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({
                parameters: { resourceType: 'Parameters', parameter: [] }
            });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('non-empty array');
        });

        test('returns error when parameter is not an array', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({
                parameters: { resourceType: 'Parameters', parameter: 'not-array' }
            });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('non-empty array');
        });

        test('returns error when parameter is missing', async () => {
            const result = await personMatchManager.runMatchWithPayloadAsync({
                parameters: { resourceType: 'Parameters' }
            });
            expect(result.issue).toBeDefined();
            expect(result.issue[0].diagnostics).toContain('non-empty array');
        });

        test('sends payload to match service successfully', async () => {
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

        test('returns timeout OperationOutcome on timeout', async () => {
            const superagent = require('superagent');
            const originalPost = superagent.post;
            superagent.post = jestGlobal.fn().mockReturnValue({
                send: jestGlobal.fn().mockReturnThis(),
                set: jestGlobal.fn().mockReturnThis(),
                retry: jestGlobal.fn().mockReturnThis(),
                timeout: jestGlobal.fn().mockRejectedValue(Object.assign(new Error('timeout'), { timeout: true }))
            });

            try {
                const parameters = {
                    resourceType: 'Parameters',
                    parameter: [{ name: 'resource', resource: { resourceType: 'Patient' } }]
                };

                const result = await personMatchManager.runMatchWithPayloadAsync({ parameters });
                expect(result.issue).toBeDefined();
                expect(result.issue[0].code).toBe('timeout');
                expect(result.issue[0].diagnostics).toContain('timed out');
            } finally {
                superagent.post = originalPost;
            }
        });

        test('throws non-timeout errors', async () => {
            const superagent = require('superagent');
            const originalPost = superagent.post;
            superagent.post = jestGlobal.fn().mockReturnValue({
                send: jestGlobal.fn().mockReturnThis(),
                set: jestGlobal.fn().mockReturnThis(),
                retry: jestGlobal.fn().mockReturnThis(),
                timeout: jestGlobal.fn().mockRejectedValue(new Error('500 Internal'))
            });

            try {
                const parameters = {
                    resourceType: 'Parameters',
                    parameter: [{ name: 'resource', resource: { resourceType: 'Patient' } }]
                };

                await expect(personMatchManager.runMatchWithPayloadAsync({ parameters })).rejects.toThrow('500 Internal');
            } finally {
                superagent.post = originalPost;
            }
        });

        test('sends correct authorization header', async () => {
            let capturedHeaders;
            nock('http://match-service.example.com')
                .post('/match')
                .reply(function () {
                    capturedHeaders = this.req.headers;
                    return [200, { entry: [] }];
                });

            const parameters = {
                resourceType: 'Parameters',
                parameter: [{ name: 'resource', resource: { resourceType: 'Patient' } }]
            };

            await personMatchManager.runMatchWithPayloadAsync({ parameters });
            expect(mockOAuthHelper.getAccessTokenAsync).toHaveBeenCalled();
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

        test('returns error when multiple resources found', async () => {
            const idx = { current: 0 };
            const resources = [
                { _uuid: 'uuid-1', id: 'dup-1', name: [{ family: 'Smith' }] },
                { _uuid: 'uuid-2', id: 'dup-1', name: [{ family: 'Smith' }] }
            ];
            const mockCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(idx.current < resources.length)),
                nextObject: jestGlobal.fn(() => {
                    const r = resources[idx.current];
                    idx.current++;
                    return Promise.resolve(r);
                })
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            const result = await personMatchManager.personOneToNMatchAsync({
                id: 'dup-1',
                resourceType: 'Patient',
                requestInfo: { requestId: 'req-1' }
            });
            expect(result.issue[0].code).toBe('info');
            expect(result.issue[0].diagnostics).toContain('Multiple resources');
        });

        test('strips resourceType prefix from id', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                nextObject: jestGlobal.fn()
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            const result = await personMatchManager.personOneToNMatchAsync({
                id: 'Patient/patient-1',
                requestInfo: { requestId: 'req-1' }
            });
            // Should strip Patient/ prefix and use Patient as resourceType
            expect(result.issue[0].diagnostics).toContain('Patient');
        });

        test('successful 1:N match sends demographics only', async () => {
            const resource = {
                _uuid: 'uuid-1',
                id: 'patient-1',
                name: [{ family: 'Smith', given: ['John'] }],
                gender: 'male',
                birthDate: '1990-01-01',
                meta: { source: 'http://source.com' },
                extension: [{ url: 'http://ext.com', value: 'v' }]
            };
            const idx = { current: 0 };
            const mockCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(idx.current < 1)),
                nextObject: jestGlobal.fn(() => {
                    idx.current++;
                    return Promise.resolve(resource);
                })
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            nock('http://match-service.example.com')
                .post('/match', (body) => {
                    // Verify body contains only demographics
                    const param = body.parameter[0].resource;
                    expect(param.name).toEqual([{ family: 'Smith', given: ['John'] }]);
                    expect(param.gender).toBe('male');
                    expect(param.birthDate).toBe('1990-01-01');
                    expect(param.meta).toBeUndefined();
                    expect(param.extension).toBeUndefined();
                    return true;
                })
                .reply(200, { entry: [{ search: { score: 0.92 } }] });

            const result = await personMatchManager.personOneToNMatchAsync({
                id: 'patient-1',
                resourceType: 'Patient',
                requestInfo: { requestId: 'req-1' }
            });

            expect(result.entry[0].search.score).toBe(0.92);
        });

        test('returns matchRequest and matchResponse when includeMatchRequest is true', async () => {
            const resource = {
                _uuid: 'uuid-1',
                id: 'patient-1',
                name: [{ family: 'Smith' }]
            };
            const idx = { current: 0 };
            const mockCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(idx.current < 1)),
                nextObject: jestGlobal.fn(() => {
                    idx.current++;
                    return Promise.resolve(resource);
                })
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [] });

            const result = await personMatchManager.personOneToNMatchAsync({
                id: 'patient-1',
                resourceType: 'Patient',
                requestInfo: { requestId: 'req-1' },
                includeMatchRequest: true
            });

            expect(result.matchRequest).toBeDefined();
            expect(result.matchResponse).toBeDefined();
            expect(result.matchRequest.resourceType).toBe('Parameters');
        });

        test('uses matchResourceType for the demographic resource type', async () => {
            const resource = {
                _uuid: 'uuid-1',
                id: 'patient-1',
                name: [{ family: 'Jones' }]
            };
            const idx = { current: 0 };
            const mockCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(idx.current < 1)),
                nextObject: jestGlobal.fn(() => {
                    idx.current++;
                    return Promise.resolve(resource);
                })
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            nock('http://match-service.example.com')
                .post('/match', (body) => {
                    expect(body.parameter[0].resource.resourceType).toBe('Person');
                    return true;
                })
                .reply(200, { entry: [] });

            await personMatchManager.personOneToNMatchAsync({
                id: 'patient-1',
                resourceType: 'Patient',
                matchResourceType: 'Person',
                requestInfo: { requestId: 'req-1' }
            });
        });

        test('returns timeout OperationOutcome on timeout', async () => {
            const resource = { _uuid: 'uuid-1', id: 'patient-1', name: [{ family: 'Smith' }] };
            const idx = { current: 0 };
            const mockCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(idx.current < 1)),
                nextObject: jestGlobal.fn(() => { idx.current++; return Promise.resolve(resource); })
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            const superagent = require('superagent');
            const originalPost = superagent.post;
            superagent.post = jestGlobal.fn().mockReturnValue({
                send: jestGlobal.fn().mockReturnThis(),
                set: jestGlobal.fn().mockReturnThis(),
                retry: jestGlobal.fn().mockReturnThis(),
                timeout: jestGlobal.fn().mockRejectedValue(Object.assign(new Error('timeout'), { timeout: true }))
            });

            try {
                const result = await personMatchManager.personOneToNMatchAsync({
                    id: 'patient-1',
                    resourceType: 'Patient',
                    requestInfo: { requestId: 'req-1' }
                });

                expect(result.issue[0].code).toBe('timeout');
            } finally {
                superagent.post = originalPost;
            }
        });

        test('executes postRequestProcessor and clears cache in finally', async () => {
            const resource = { _uuid: 'uuid-1', id: 'patient-1', name: [{ family: 'Smith' }] };
            const idx = { current: 0 };
            const mockCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(idx.current < 1)),
                nextObject: jestGlobal.fn(() => { idx.current++; return Promise.resolve(resource); })
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [] });

            await personMatchManager.personOneToNMatchAsync({
                id: 'patient-1',
                resourceType: 'Patient',
                requestInfo: { requestId: 'req-42' }
            });

            expect(mockPostRequestProcessor.executeAsync).toHaveBeenCalledWith({ requestId: 'req-42' });
            expect(mockRequestSpecificCache.clearAsync).toHaveBeenCalledWith({ requestId: 'req-42' });
        });

        test('accepts Person as resourceType', async () => {
            const resource = { _uuid: 'uuid-1', id: 'person-1', name: [{ family: 'Doe' }] };
            const idx = { current: 0 };
            const mockCursor = {
                hasNext: jestGlobal.fn(() => Promise.resolve(idx.current < 1)),
                nextObject: jestGlobal.fn(() => { idx.current++; return Promise.resolve(resource); })
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            nock('http://match-service.example.com')
                .post('/match')
                .reply(200, { entry: [] });

            const result = await personMatchManager.personOneToNMatchAsync({
                id: 'person-1',
                resourceType: 'Person',
                requestInfo: { requestId: 'req-1' }
            });

            expect(result.entry).toBeDefined();
        });
    });
});
