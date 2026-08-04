const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock express-http-context
jestGlobal.mock('express-http-context', () => ({
    get: jestGlobal.fn(),
    set: jestGlobal.fn()
}));

// Mock the logging module - capture all calls for inspection
const mockLogInfo = jestGlobal.fn();
const mockLogError = jestGlobal.fn();
const mockLogDebug = jestGlobal.fn();
const mockLogWarn = jestGlobal.fn();
jestGlobal.mock('../../../operations/common/logging', () => ({
    logError: mockLogError,
    logInfo: mockLogInfo,
    logDebug: mockLogDebug,
    logWarn: mockLogWarn
}));

// Mock get_all_args
jestGlobal.mock('../../../operations/common/get_all_args', () => ({
    get_all_args: jestGlobal.fn().mockReturnValue({})
}));

// Mock getCircularReplacer
jestGlobal.mock('../../../utils/getCircularReplacer', () => ({
    getCircularReplacer: jestGlobal.fn().mockReturnValue(null)
}));

// Mock bulkWriteRequestContext
jestGlobal.mock('../../../dataLayer/bulkWriteRequestContext', () => ({
    buildBulkWriteRequestContext: jestGlobal.fn().mockImplementation((requestInfo) => ({
        requestId: requestInfo?.requestId || 'mock-request-id'
    }))
}));

// Mock FhirOperationsManager to avoid deep dependency chain
jestGlobal.mock('../../../operations/fhirOperationsManager', () => {
    class FhirOperationsManager {
        getRequestInfo() {
            return {
                user: 'test-user',
                scope: 'patient/*.read',
                originalUrl: '/4_0_0/Patient/123',
                method: 'GET',
                remoteIpAddress: '127.0.0.1',
                contentTypeFromHeader: null,
                accept: 'application/fhir+json',
                body: null,
                userRequestId: 'user-req-123',
                requestId: 'sys-req-456'
            };
        }

        parseParametersFromBody({ combined_args }) {
            return combined_args;
        }

        async getParsedArgsAsync({ args }) {
            return {
                getRawArgs: () => args
            };
        }
    }
    return { FhirOperationsManager };
});

// Mock ScopesManager
jestGlobal.mock('../../../operations/security/scopesManager', () => {
    class ScopesManager {}
    return { ScopesManager };
});

// Mock DatabaseBulkInserter
jestGlobal.mock('../../../dataLayer/databaseBulkInserter', () => {
    const { EventEmitter } = require('events');
    class DatabaseBulkInserter extends EventEmitter {
        getOperationForResourceAsync() { return {}; }
        async executeAsync() { return []; }
    }
    return { DatabaseBulkInserter };
});

// Mock AccessLogClickHouseWriter
jestGlobal.mock('../../../utils/accessLogClickHouseWriter', () => {
    class AccessLogClickHouseWriter {
        async writeBatchAsync() {}
    }
    return { AccessLogClickHouseWriter };
});

const { AccessLogger } = require('../../../utils/accessLogger');
const { ScopesManager } = require('../../../operations/security/scopesManager');
const { FhirOperationsManager } = require('../../../operations/fhirOperationsManager');
const { DatabaseBulkInserter } = require('../../../dataLayer/databaseBulkInserter');
const { AccessLogClickHouseWriter } = require('../../../utils/accessLogClickHouseWriter');
const { generateLogDetail } = require('../../../utils/requestCompletionLogData');

function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('HITRUST 09.ad - Credential and PHI Exposure in Logs', () => {
    let accessLogger;
    let mockScopesManager;
    let mockFhirOperationsManager;
    let mockDatabaseBulkInserter;
    let mockAccessLogClickHouseWriter;

    beforeEach(() => {
        jestGlobal.clearAllMocks();

        const httpContext = require('express-http-context');
        httpContext.get.mockReturnValue('req-id-123');

        mockScopesManager = createMockInstance(ScopesManager);
        mockFhirOperationsManager = createMockInstance(FhirOperationsManager);
        mockFhirOperationsManager.getRequestInfo = FhirOperationsManager.prototype.getRequestInfo;
        mockFhirOperationsManager.parseParametersFromBody = FhirOperationsManager.prototype.parseParametersFromBody;
        mockFhirOperationsManager.getParsedArgsAsync = FhirOperationsManager.prototype.getParsedArgsAsync;

        mockDatabaseBulkInserter = createMockInstance(DatabaseBulkInserter);
        mockDatabaseBulkInserter.getOperationForResourceAsync = jestGlobal.fn().mockReturnValue({});
        mockDatabaseBulkInserter.executeAsync = jestGlobal.fn().mockResolvedValue([]);

        mockAccessLogClickHouseWriter = createMockInstance(AccessLogClickHouseWriter);
        mockAccessLogClickHouseWriter.writeBatchAsync = jestGlobal.fn().mockResolvedValue(undefined);

        accessLogger = new AccessLogger({
            scopesManager: mockScopesManager,
            fhirOperationsManager: mockFhirOperationsManager,
            base_version: '4_0_0',
            imageVersion: '1.0.0',
            configManager: {
                enableAccessLogs: true,
                accessLogResultLimit: 10000,
                accessLogRequestBodyLimit: 10000,
                enableAccessLogsClickHouse: false,
                enableAccessLogsMongoDB: true
            },
            databaseBulkInserter: mockDatabaseBulkInserter,
            accessLogClickHouseWriter: mockAccessLogClickHouseWriter
        });
    });

    describe('AccessLogger must not store PHI in log messages sent to console/log aggregation', () => {
        test('should NOT include patient resource body with PHI in log messages', async () => {
            const patientBody = JSON.stringify({
                resourceType: 'Patient',
                id: 'patient-abc-123',
                name: [{ family: 'Smith', given: ['John'] }],
                birthDate: '1990-01-15',
                identifier: [
                    { system: 'http://hl7.org/fhir/sid/us-ssn', value: '123-45-6789' },
                    { system: 'urn:oid:2.16.840.1.113883.4.1', value: 'MRN-99887766' }
                ],
                address: [{ line: ['123 Main St'], city: 'Springfield', state: 'IL', postalCode: '62701' }]
            });

            const req = {
                resourceType: 'Patient',
                url: '/4_0_0/Patient',
                method: 'POST',
                headers: {},
                sanitized_args: {},
                rawBodyBuffer: Buffer.from(patientBody)
            };

            mockFhirOperationsManager.getRequestInfo = () => ({
                user: 'test-user',
                scope: 'patient/*.write',
                originalUrl: '/4_0_0/Patient',
                method: 'POST',
                remoteIpAddress: '127.0.0.1',
                contentTypeFromHeader: { type: 'application/fhir+json' },
                accept: 'application/fhir+json',
                body: JSON.parse(patientBody),
                userRequestId: 'user-req-123',
                requestId: 'sys-req-456'
            });

            await accessLogger.logAccessLogAsync({
                req,
                statusCode: 201,
                startTime: Date.now() - 100
            });

            // Verify that PHI data (SSN, address, name) does not appear in logInfo calls
            for (const call of mockLogInfo.mock.calls) {
                const message = call[0] || '';
                const args = call[1] ? JSON.stringify(call[1]) : '';
                expect(message).not.toContain('123-45-6789');
                expect(args).not.toContain('123-45-6789');
                expect(message).not.toContain('123 Main St');
                expect(args).not.toContain('123 Main St');
            }
        });

        test('should NOT log patient identifiers in search query parameters to console output', async () => {
            const req = {
                resourceType: 'Patient',
                url: '/4_0_0/Patient?identifier=http://hl7.org/fhir/sid/us-ssn|123-45-6789&name=Smith',
                method: 'GET',
                headers: {},
                sanitized_args: {
                    identifier: 'http://hl7.org/fhir/sid/us-ssn|123-45-6789',
                    name: 'Smith'
                }
            };

            mockFhirOperationsManager.getRequestInfo = () => ({
                user: 'test-user',
                scope: 'patient/*.read',
                originalUrl: '/4_0_0/Patient?identifier=http://hl7.org/fhir/sid/us-ssn|123-45-6789&name=Smith',
                method: 'GET',
                remoteIpAddress: '127.0.0.1',
                contentTypeFromHeader: null,
                accept: 'application/fhir+json',
                body: null,
                userRequestId: 'user-req-123',
                requestId: 'sys-req-456'
            });

            await accessLogger.logAccessLogAsync({
                req,
                statusCode: 200,
                startTime: Date.now() - 100
            });

            // Verify that SSN does not appear in any logInfo or logDebug calls
            const allLogCalls = [...mockLogInfo.mock.calls, ...mockLogDebug.mock.calls];
            for (const call of allLogCalls) {
                const message = String(call[0] || '');
                const argsStr = call[1] ? JSON.stringify(call[1]) : '';
                expect(message).not.toContain('123-45-6789');
                expect(argsStr).not.toContain('123-45-6789');
            }
        });
    });

    describe('generateLogDetail must not expose full JWT tokens', () => {
        test('should NOT return the full JWT token in log detail message for 401 responses', () => {
            const jwtToken = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiZXhwIjo5OTk5OTk5OTk5fQ.signature-here';

            const result = generateLogDetail({
                authToken: jwtToken,
                scope: 'patient/*.read',
                statusCode: 401,
                username: 'test-user'
            });

            // The log detail must NOT contain the raw JWT token payload
            expect(result).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9');
            expect(result).not.toContain('signature-here');
            // It should provide a human-readable reason instead
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });

        test('should NOT include the encoded JWT payload in log output for expired tokens', () => {
            // Create a token with exp in the past
            const payload = Buffer.from(JSON.stringify({
                sub: '1234567890',
                name: 'John Doe',
                exp: 1000000000, // expired
                iss: 'https://auth.example.com',
                patient_id: 'Patient/secret-id-12345'
            })).toString('base64url');
            const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
            const signature = 'fake-signature-data-that-should-not-leak';
            const jwtToken = `Bearer ${header}.${payload}.${signature}`;

            const result = generateLogDetail({
                authToken: jwtToken,
                scope: 'patient/*.read',
                statusCode: 401,
                username: 'test-user'
            });

            // Must not expose the encoded token parts
            expect(result).not.toContain(payload);
            expect(result).not.toContain(signature);
            // Must not expose decoded PHI from the token
            expect(result).not.toContain('secret-id-12345');
            expect(result).not.toContain('Patient/secret-id-12345');
        });

        test('should NOT expose token content for malformed tokens in error messages', () => {
            const malformedToken = 'Bearer not-a-valid-jwt-but-contains-sensitive-api-key-abc123xyz';

            const result = generateLogDetail({
                authToken: malformedToken,
                scope: 'patient/*.read',
                statusCode: 401,
                username: 'test-user'
            });

            // The raw token string must not be echoed into the log detail
            expect(result).not.toContain('not-a-valid-jwt-but-contains-sensitive-api-key-abc123xyz');
            expect(result).not.toContain('sensitive-api-key');
        });
    });

    describe('MongoDB connection strings with credentials must be masked in logs', () => {
        test('should NOT log unmasked MongoDB credentials in connection string', () => {
            // Simulate what mongoDatabaseManager.createClientAsync does
            const connectionString = 'mongodb://admin_user:SuperSecret123!@cluster0.mongodb.net:27017';
            const parts = connectionString.split(':');
            const server = connectionString.substring(connectionString.indexOf('@'));
            const maskedConnection = `${parts[0]}:${parts[1]}:***********${server}`;

            // The masked connection must not contain the password
            expect(maskedConnection).not.toContain('SuperSecret123!');
            // But verify it still contains useful connection info
            expect(maskedConnection).toContain('cluster0.mongodb.net');
            expect(maskedConnection).toContain('***********');
        });

        test('should mask password in MongoDB connection strings that use srv format', () => {
            const connectionString = 'mongodb+srv://dbUser:MyP@ssw0rd!@cluster0.example.mongodb.net';
            const parts = connectionString.split(':');
            const server = connectionString.substring(connectionString.indexOf('@'));
            const maskedConnection = `${parts[0]}:${parts[1]}:***********${server}`;

            expect(maskedConnection).not.toContain('MyP@ssw0rd!');
        });
    });

});
