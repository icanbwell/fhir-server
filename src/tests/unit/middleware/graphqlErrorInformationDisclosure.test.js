const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

/**
 * HITRUST/HIPAA Information Disclosure Tests - GraphQL error path
 *
 * Extracted from the quarantined src/tests/unit/middleware/errorInformationDisclosure.test.js
 * (see jest.config.js testPathIgnorePatterns). That file mixes real regression coverage with
 * a number of synthetic/fabricated scenarios that don't reflect real code paths in this repo.
 * These two tests are the real ones: they lock in the fix for the GraphQL error formatter
 * unconditionally echoing err.message (including for 5xx responses), which is an information
 * disclosure bug (see src/middleware/graphql/graphqlErrorFormatter.js and
 * src/utils/convertErrorToOperationOutcome.js for the equivalent REST-path redaction).
 *
 * The remaining ~19 tests in the quarantined file were left in place for separate triage;
 * they are not un-quarantined here.
 */

// --- Mocks ---
jest.mock('express-http-context', () => ({
    get: jest.fn().mockReturnValue('req-id-123'),
    set: jest.fn()
}));

const { graphqlErrorFormatter } = require('../../../middleware/graphql/graphqlErrorFormatter');

describe('GraphQL error formatter - Information disclosure', () => {
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
});
