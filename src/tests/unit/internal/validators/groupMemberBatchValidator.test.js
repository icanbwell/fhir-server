const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../constants/clickHouseConstants', () => ({
    LIMITS: {
        MAX_BATCH_SIZE: 50000,
        DEFAULT_PAGE_SIZE: 100,
        MIN_PAGE_SIZE: 1,
        MAX_PAGE_SIZE: 10000
    }
}));

jestObj.mock('../../../../utils/fhir/referenceParser', () => ({
    FhirReferenceParser: {
        isValid: (ref) => {
            if (!ref || typeof ref !== 'string') return false;
            return ref.includes('/') || ref.startsWith('urn:');
        }
    }
}));

const { GroupMemberBatchValidator } = require('../../../../internal/validators/groupMemberBatchValidator');

describe('GroupMemberBatchValidator', () => {
    let mockCheckGroupExists;

    beforeEach(() => {
        mockCheckGroupExists = jestObj.fn().mockResolvedValue(true);
    });

    describe('validateBatchRequest', () => {
        test('passes validation with valid references and existing group', async () => {
            const references = ['Patient/1', 'Patient/2', 'Patient/3'];

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(references, 'group-123', mockCheckGroupExists)
            ).resolves.toBeUndefined();
        });

        test('throws when references is not an array', async () => {
            await expect(
                GroupMemberBatchValidator.validateBatchRequest('Patient/1', 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('References must be an array');
        });

        test('throws when references is null', async () => {
            await expect(
                GroupMemberBatchValidator.validateBatchRequest(null, 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('References must be an array');
        });

        test('throws when references is an object', async () => {
            await expect(
                GroupMemberBatchValidator.validateBatchRequest({}, 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('References must be an array');
        });

        test('throws when references array is empty', async () => {
            await expect(
                GroupMemberBatchValidator.validateBatchRequest([], 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('References array cannot be empty');
        });

        test('throws when batch size exceeds MAX_BATCH_SIZE', async () => {
            const hugeArray = new Array(50001).fill('Patient/1');

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(hugeArray, 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('Batch size 50001 exceeds maximum 50000');
        });

        test('accepts batch at exactly MAX_BATCH_SIZE', async () => {
            const maxArray = new Array(50000).fill('Patient/1');

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(maxArray, 'group-123', mockCheckGroupExists)
            ).resolves.toBeUndefined();
        });

        test('throws when groupId is empty string', async () => {
            await expect(
                GroupMemberBatchValidator.validateBatchRequest(['Patient/1'], '', mockCheckGroupExists)
            ).rejects.toThrow('Valid groupId is required');
        });

        test('throws when groupId is null', async () => {
            await expect(
                GroupMemberBatchValidator.validateBatchRequest(['Patient/1'], null, mockCheckGroupExists)
            ).rejects.toThrow('Valid groupId is required');
        });

        test('throws when groupId is undefined', async () => {
            await expect(
                GroupMemberBatchValidator.validateBatchRequest(['Patient/1'], undefined, mockCheckGroupExists)
            ).rejects.toThrow('Valid groupId is required');
        });

        test('throws when groupId is a number (not string)', async () => {
            await expect(
                GroupMemberBatchValidator.validateBatchRequest(['Patient/1'], 123, mockCheckGroupExists)
            ).rejects.toThrow('Valid groupId is required');
        });

        test('throws when group does not exist', async () => {
            mockCheckGroupExists.mockResolvedValue(false);

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(['Patient/1'], 'nonexistent', mockCheckGroupExists)
            ).rejects.toThrow('Group nonexistent not found');
        });

        test('calls checkGroupExistsFn with the correct groupId', async () => {
            await GroupMemberBatchValidator.validateBatchRequest(
                ['Patient/1'], 'my-group-id', mockCheckGroupExists
            );

            expect(mockCheckGroupExists).toHaveBeenCalledWith('my-group-id');
        });

        test('throws when references contain invalid format', async () => {
            const references = ['Patient/1', 'InvalidReference', 'Patient/3'];

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(references, 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('Invalid reference format: InvalidReference');
        });

        test('shows up to 3 invalid references in error message', async () => {
            const references = ['bad1', 'bad2', 'bad3', 'bad4', 'bad5'];

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(references, 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('Invalid reference format: bad1, bad2, bad3 and 2 more');
        });

        test('shows exactly 3 invalid references without "and X more" when exactly 3', async () => {
            const references = ['bad1', 'bad2', 'bad3'];

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(references, 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('Invalid reference format: bad1, bad2, bad3');
        });

        test('accepts URN references as valid', async () => {
            const references = ['urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7'];

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(references, 'group-123', mockCheckGroupExists)
            ).resolves.toBeUndefined();
        });

        test('accepts absolute URL references as valid', async () => {
            const references = ['https://example.com/fhir/Patient/123'];

            await expect(
                GroupMemberBatchValidator.validateBatchRequest(references, 'group-123', mockCheckGroupExists)
            ).resolves.toBeUndefined();
        });

        test('validates references AFTER checking group exists', async () => {
            // Group check happens before reference format validation in the code
            mockCheckGroupExists.mockResolvedValue(false);
            const references = ['InvalidRef'];

            // Should throw about group not found, not invalid reference
            await expect(
                GroupMemberBatchValidator.validateBatchRequest(references, 'group-123', mockCheckGroupExists)
            ).rejects.toThrow('Group group-123 not found');
        });

        test('validation order: array check -> empty check -> size check -> groupId -> group exists -> refs', async () => {
            // Non-array fails first even with invalid groupId
            await expect(
                GroupMemberBatchValidator.validateBatchRequest('not-array', '', mockCheckGroupExists)
            ).rejects.toThrow('References must be an array');

            // Empty array fails before groupId check
            await expect(
                GroupMemberBatchValidator.validateBatchRequest([], '', mockCheckGroupExists)
            ).rejects.toThrow('References array cannot be empty');
        });
    });

    describe('validatePaginationParams', () => {
        test('returns default page size when count is undefined', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(undefined, undefined);

            expect(result).toEqual({
                count: 100,
                afterReference: null
            });
        });

        test('returns default page size when count is null', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(null, undefined);

            expect(result).toEqual({
                count: 100,
                afterReference: null
            });
        });

        test('accepts valid count within range', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(50, undefined);

            expect(result.count).toBe(50);
        });

        test('caps count at MAX_PAGE_SIZE', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(20000, undefined);

            expect(result.count).toBe(10000);
        });

        test('accepts count at exactly MAX_PAGE_SIZE', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(10000, undefined);

            expect(result.count).toBe(10000);
        });

        test('accepts count at MIN_PAGE_SIZE', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(1, undefined);

            expect(result.count).toBe(1);
        });

        test('throws when count is less than MIN_PAGE_SIZE', () => {
            expect(() =>
                GroupMemberBatchValidator.validatePaginationParams(0, undefined)
            ).toThrow('Count must be at least 1');
        });

        test('throws when count is negative', () => {
            expect(() =>
                GroupMemberBatchValidator.validatePaginationParams(-5, undefined)
            ).toThrow('Count must be at least 1');
        });

        test('throws when count is not a number', () => {
            expect(() =>
                GroupMemberBatchValidator.validatePaginationParams('abc', undefined)
            ).toThrow('Count must be at least 1');
        });

        test('accepts valid afterReference', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(50, 'Patient/123');

            expect(result.afterReference).toBe('Patient/123');
        });

        test('returns null afterReference when not provided', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(50, undefined);

            expect(result.afterReference).toBeNull();
        });

        test('returns null afterReference when empty string', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(50, '');

            expect(result.afterReference).toBeNull();
        });

        test('throws when afterReference has invalid format', () => {
            expect(() =>
                GroupMemberBatchValidator.validatePaginationParams(50, 'InvalidReference')
            ).toThrow('Invalid afterReference format: InvalidReference');
        });

        test('accepts URN format in afterReference', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(
                50,
                'urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7'
            );

            expect(result.afterReference).toBe('urn:uuid:53fefa32-fcbb-4ff8-8a92-55ee120877b7');
        });

        test('accepts absolute URL in afterReference', () => {
            const result = GroupMemberBatchValidator.validatePaginationParams(
                50,
                'https://example.com/fhir/Patient/456'
            );

            expect(result.afterReference).toBe('https://example.com/fhir/Patient/456');
        });
    });
});
