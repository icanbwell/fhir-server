const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

/**
 * HITRUST/HIPAA Information Disclosure Tests
 *
 * These tests verify that error responses do NOT expose:
 * - Internal system paths or stack traces
 * - MongoDB query details (collection names, filter conditions, field paths)
 * - PHI (patient data echoed in validation errors)
 * - Internal tenant structure or cross-tenant resource IDs
 * - Debug/verbose information in production mode
 *
 * Tests assert CORRECT (secure) behavior and should FAIL on buggy code
 * that leaks information.
 */

// --- Mocks ---
jest.mock('express-http-context', () => ({
    get: jest.fn().mockReturnValue('req-id-123'),
    set: jest.fn()
}));

const { convertErrorToOperationOutcome } = require('../../../utils/convertErrorToOperationOutcome');
const { handleServerError } = require('../../../routeHandlers/handleError');
const { graphqlErrorFormatter } = require('../../../middleware/graphql/graphqlErrorFormatter');

describe('Error Information Disclosure Prevention', () => {
    let mockReq;
    let mockRes;
    let mockNext;
    let responseBody;

    beforeEach(() => {
        responseBody = null;
        mockReq = {
            id: 'request-123',
            params: { base_version: '4_0_0' },
            headers: {}
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockImplementation((body) => {
                responseBody = body;
                return mockRes;
            }),
            setHeader: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            end: jest.fn().mockReturnThis(),
            headersSent: false
        };
        mockNext = jest.fn();
    });

    describe('convertErrorToOperationOutcome - Internal server errors', () => {
        test('should NOT include error message in OperationOutcome for 5xx errors', () => {
            const error = new Error('Connection refused to mongodb://internal-host:27017/fhir_db');
            const result = convertErrorToOperationOutcome({ error, internalError: true });

            const issueText = result.issue[0].details?.text || result.issue[0].diagnostics || '';
            expect(issueText).not.toContain('mongodb://');
            expect(issueText).not.toContain('internal-host');
            expect(issueText).not.toContain('27017');
            expect(issueText).not.toContain('fhir_db');
            expect(issueText).toBe('Internal Server Error');
        });

        test('should NOT include stack trace in OperationOutcome for internal errors', () => {
            const error = new Error('Something went wrong');
            error.stack = 'Error: Something went wrong\n    at /opt/app/src/operations/search/searchBundle.js:399:13';
            const result = convertErrorToOperationOutcome({ error, internalError: true });

            const serialized = JSON.stringify(result);
            expect(serialized).not.toContain('/opt/app');
            expect(serialized).not.toContain('searchBundle.js');
            expect(serialized).not.toContain('.js:');
        });

        test('should NOT include MongoDB collection names in OperationOutcome for internal errors', () => {
            const error = new Error('Query failed on Patient_4_0_0 collection: exceeded time limit');
            const result = convertErrorToOperationOutcome({ error, internalError: true });

            const serialized = JSON.stringify(result);
            expect(serialized).not.toContain('Patient_4_0_0');
            expect(serialized).not.toContain('collection');
        });
    });

    describe('convertErrorToOperationOutcome - Client errors (4xx)', () => {
        test('should NOT echo submitted PHI data in validation error messages', () => {
            // Simulate a validation error that might echo back PHI from the submitted resource
            const error = new Error(
                'Invalid value for Patient.name: "John Doe" is not a valid HumanName'
            );
            error.statusCode = 400;
            error.issue = [{
                severity: 'error',
                code: 'invalid',
                details: {
                    text: 'Invalid value for Patient.name: "John Doe" is not a valid HumanName'
                }
            }];

            const result = convertErrorToOperationOutcome({ error, internalError: false });
            const serialized = JSON.stringify(result);

            // The error should describe WHAT is wrong, not echo the PHI value
            expect(serialized).not.toContain('John Doe');
        });

        test('should NOT include internal file paths in client error diagnostics', () => {
            const error = new Error('Validation failed');
            error.statusCode = 400;
            error.issue = [{
                severity: 'error',
                code: 'invalid',
                diagnostics: 'Failed at /opt/app/src/operations/validate/validate.js:221',
                details: { text: 'Validation failed' }
            }];

            const result = convertErrorToOperationOutcome({ error, internalError: false });
            const serialized = JSON.stringify(result);

            expect(serialized).not.toContain('/opt/app');
            expect(serialized).not.toContain('validate.js');
        });
    });

    describe('handleServerError - Response sanitization', () => {
        test('should NOT expose MongoDB connection strings in error responses', () => {
            const error = new Error(
                'MongoServerError: connection to mongodb+srv://admin:secret@cluster0.mongodb.net/fhir_prod timed out'
            );
            error.statusCode = 500;

            handleServerError(error, mockReq, mockRes, mockNext);

            const body = responseBody;
            const serialized = JSON.stringify(body);
            expect(serialized).not.toContain('mongodb+srv://');
            expect(serialized).not.toContain('admin:secret');
            expect(serialized).not.toContain('cluster0.mongodb.net');
            expect(serialized).not.toContain('fhir_prod');
        });

        test('should NOT expose internal error stack traces to the client', () => {
            const error = new Error('Unexpected failure');
            error.statusCode = 500;
            error.stack = [
                'Error: Unexpected failure',
                '    at SearchBundle.searchAsync (/opt/app/src/operations/search/searchBundle.js:281:15)',
                '    at FhirOperationsManager.search (/opt/app/src/operations/fhirOperationsManager.js:120:30)'
            ].join('\n');

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('searchBundle.js');
            expect(serialized).not.toContain('fhirOperationsManager.js');
            expect(serialized).not.toContain('/opt/app/src');
            expect(serialized).not.toContain('at SearchBundle');
        });

        test('should NOT expose MongoDB query filter conditions in error responses', () => {
            const error = new Error(
                'Query failed: {"_sourceAssigningAuthority":"client-tenant-A","patient._uuid":"Patient/abc-123-uuid"}'
            );
            error.statusCode = 500;

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('_sourceAssigningAuthority');
            expect(serialized).not.toContain('client-tenant-A');
            expect(serialized).not.toContain('abc-123-uuid');
        });

        test('should NOT expose database collection names in error responses', () => {
            const error = new Error(
                'ns not found: fhir.Patient_4_0_0'
            );
            error.statusCode = 500;

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('Patient_4_0_0');
            expect(serialized).not.toContain('fhir.Patient');
        });

        test('should return generic message for all 5xx errors', () => {
            const error = new Error('ECONNREFUSED 10.0.0.5:27017');
            error.statusCode = 503;

            handleServerError(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(503);
            const issueText = responseBody?.issue?.[0]?.details?.text ||
                responseBody?.issue?.[0]?.diagnostics || '';
            expect(issueText).toBe('Internal Server Error');
        });

        test('should NOT include the error.message property directly for 5xx errors', () => {
            const error = new Error(
                'Timeout waiting for connection from pool: maxPoolSize=100, waitQueueTimeoutMS=30000'
            );
            error.statusCode = 500;

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('maxPoolSize');
            expect(serialized).not.toContain('waitQueueTimeoutMS');
            expect(serialized).not.toContain('pool');
        });

        test('should NOT expose resource UUIDs from other tenants in error messages', () => {
            const error = new Error(
                'Resource Patient/other-tenant-patient-uuid-12345 not accessible'
            );
            error.statusCode = 403;

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('other-tenant-patient-uuid-12345');
        });
    });

    describe('GraphQL error formatter - Information disclosure', () => {
        test('should NOT expose internal error details in GraphQL error responses', () => {
            const error = new Error(
                'Cannot read properties of null (reading "meta") at /opt/app/src/graphqlv2/resolvers.js:45'
            );
            error.statusCode = 500;

            graphqlErrorFormatter(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('/opt/app');
            expect(serialized).not.toContain('resolvers.js');
            expect(serialized).not.toContain('Cannot read properties');
        });

        test('should use generic message for 500 errors in GraphQL responses', () => {
            const error = new Error(
                'MongoServerSelectionError: Server selection timed out for cluster at 10.0.1.50:27017'
            );
            error.statusCode = 500;

            graphqlErrorFormatter(error, mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            const errorMessage = responseBody?.errors?.[0]?.message;
            expect(errorMessage).not.toContain('10.0.1.50');
            expect(errorMessage).not.toContain('27017');
            expect(errorMessage).not.toContain('MongoServerSelectionError');
            expect(errorMessage).toBe('Internal server error');
        });

        test('should NOT include stack traces in GraphQL error extensions', () => {
            const error = new Error('Internal failure');
            error.statusCode = 500;
            error.extensions = {
                stacktrace: ['Error: Internal failure', '    at Object.<anonymous> (/opt/app/src/index.js:44:5)'],
                exception: { stacktrace: ['line 1', 'line 2'] }
            };

            graphqlErrorFormatter(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('stacktrace');
            expect(serialized).not.toContain('/opt/app');
            expect(serialized).not.toContain('index.js');
        });
    });

    describe('MongoError information leakage prevention', () => {
        test('should NOT pass raw MongoError message to client responses', () => {
            // Simulate a MongoError that contains query details in its message
            const error = new Error(
                'Query timed out: {"_sourceAssigningAuthority":"tenant-xyz","resourceType":"Observation"}: ' +
                'collection=Observation_4_0_0 [elapsedTime=30.5 secs]'
            );
            error.statusCode = 500;
            error.collection = 'Observation_4_0_0';
            error.query = { _sourceAssigningAuthority: 'tenant-xyz', resourceType: 'Observation' };

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('Observation_4_0_0');
            expect(serialized).not.toContain('tenant-xyz');
            expect(serialized).not.toContain('_sourceAssigningAuthority');
            expect(serialized).not.toContain('elapsedTime');
        });

        test('should NOT expose query options (projection, sort) in error responses', () => {
            const error = new Error(
                'Sort exceeded memory limit: {sort: {"meta.lastUpdated": -1}, projection: {_id: 0, "name.family": 1}}'
            );
            error.statusCode = 500;

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('meta.lastUpdated');
            expect(serialized).not.toContain('projection');
            expect(serialized).not.toContain('name.family');
        });
    });

    describe('Debug mode information exposure', () => {
        test('handleServerError should NOT include debug data when LOGLEVEL is DEBUG', () => {
            const originalLoglevel = process.env.LOGLEVEL;
            process.env.LOGLEVEL = 'DEBUG';

            try {
                const error = new Error('Query failed on internal-collection');
                error.statusCode = 500;

                handleServerError(error, mockReq, mockRes, mockNext);

                const serialized = JSON.stringify(responseBody);
                expect(serialized).not.toContain('internal-collection');
                // Response should still be the generic message even in debug mode
                const issueText = responseBody?.issue?.[0]?.details?.text ||
                    responseBody?.issue?.[0]?.diagnostics || '';
                expect(issueText).toBe('Internal Server Error');
            } finally {
                if (originalLoglevel === undefined) {
                    delete process.env.LOGLEVEL;
                } else {
                    process.env.LOGLEVEL = originalLoglevel;
                }
            }
        });
    });

    describe('Sensitive header exposure prevention', () => {
        test('should NOT set headers that expose internal infrastructure', () => {
            const error = new Error('Service unavailable');
            error.statusCode = 503;

            handleServerError(error, mockReq, mockRes, mockNext);

            // Verify no infrastructure-revealing headers are set
            const setHeaderCalls = mockRes.setHeader.mock.calls;
            const headerNames = setHeaderCalls.map(call => call[0].toLowerCase());

            expect(headerNames).not.toContain('x-powered-by');
            expect(headerNames).not.toContain('server');

            // Verify header values don't contain internal details
            for (const [, value] of setHeaderCalls) {
                const valStr = String(value);
                expect(valStr).not.toMatch(/mongodb/i);
                expect(valStr).not.toMatch(/express/i);
                expect(valStr).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // IP addresses
            }
        });
    });

    describe('Validation error data echo prevention', () => {
        test('should NOT echo submitted resource data in 400 validation responses', () => {
            // Simulate a BadRequestError where the error message contains submitted PHI
            const error = new Error(
                'Invalid resource: Patient {"resourceType":"Patient","name":[{"family":"Smith","given":["Jane"]}],"birthDate":"1990-05-15","identifier":[{"system":"http://hl7.org/fhir/sid/us-ssn","value":"123-45-6789"}]}'
            );
            error.statusCode = 400;
            error.issue = [{
                severity: 'error',
                code: 'invalid',
                details: {
                    text: error.message
                }
            }];

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            // SSN should never appear in error response
            expect(serialized).not.toContain('123-45-6789');
            // Patient name should not be echoed
            expect(serialized).not.toContain('Smith');
            expect(serialized).not.toContain('Jane');
            // Birth date should not be echoed
            expect(serialized).not.toContain('1990-05-15');
        });

        test('should NOT echo Authorization token details in error responses', () => {
            const error = new Error(
                'Token validation failed for bearer: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'
            );
            error.statusCode = 401;

            handleServerError(error, mockReq, mockRes, mockNext);

            const serialized = JSON.stringify(responseBody);
            expect(serialized).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9');
            expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]+/); // JWT pattern
        });
    });
});
