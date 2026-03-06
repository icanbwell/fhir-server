const { LIMITS } = require('../../constants/clickHouseConstants');
const { FhirReferenceParser } = require('../../utils/fhir/referenceParser');

/**
 * Validator for Group member batch operations
 *
 * Ensures that batch add/remove operations meet all requirements:
 * - Valid input format
 * - Within size limits
 * - Group exists
 * - References are well-formed
 */
class GroupMemberBatchValidator {
    /**
     * Validates batch member operation request
     *
     * @param {Array<string>} references - Array of member references to add/remove
     * @param {string} groupId - Group ID being modified
     * @param {Function} checkGroupExistsFn - Async function(groupId) => boolean
     *
     * @throws {Error} If validation fails with descriptive message
     *
     * @returns {Promise<void>}
     *
     * @example
     * await GroupMemberBatchValidator.validateBatchRequest(
     *   ['Patient/1', 'Patient/2'],
     *   'group-123',
     *   async (id) => await db.exists('Group', id)
     * );
     */
    static async validateBatchRequest(references, groupId, checkGroupExistsFn) {
        // Validate references is array
        if (!Array.isArray(references)) {
            throw new Error('References must be an array');
        }

        // Validate array is not empty
        if (references.length === 0) {
            throw new Error('References array cannot be empty');
        }

        // Validate batch size
        if (references.length > LIMITS.MAX_BATCH_SIZE) {
            throw new Error(
                `Batch size ${references.length} exceeds maximum ${LIMITS.MAX_BATCH_SIZE}`
            );
        }

        // Validate group ID is provided
        if (!groupId || typeof groupId !== 'string') {
            throw new Error('Valid groupId is required');
        }

        // Validate group exists
        const groupExists = await checkGroupExistsFn(groupId);
        if (!groupExists) {
            throw new Error(`Group ${groupId} not found`);
        }

        // Validate each reference format
        const invalidRefs = references.filter(ref => !FhirReferenceParser.isValid(ref));
        if (invalidRefs.length > 0) {
            const sample = invalidRefs.slice(0, 3).join(', ');
            const more = invalidRefs.length > 3 ? ` and ${invalidRefs.length - 3} more` : '';
            throw new Error(`Invalid reference format: ${sample}${more}`);
        }
    }

    /**
     * Validates pagination parameters
     *
     * @param {number} [count] - Page size
     * @param {string} [afterReference] - Reference to seek after
     *
     * @throws {Error} If validation fails
     *
     * @returns {Object} Normalized parameters { count, afterReference }
     *
     * @example
     * const params = GroupMemberBatchValidator.validatePaginationParams(100, 'Patient/50');
     * // Returns: { count: 100, afterReference: 'Patient/50' }
     */
    static validatePaginationParams(count, afterReference) {
        let normalizedCount = count;

        // Default count
        if (normalizedCount === undefined || normalizedCount === null) {
            normalizedCount = LIMITS.DEFAULT_PAGE_SIZE;
        }

        // Validate count is a positive integer
        if (typeof normalizedCount !== 'number' || normalizedCount < LIMITS.MIN_PAGE_SIZE) {
            throw new Error(`Count must be at least ${LIMITS.MIN_PAGE_SIZE}`);
        }

        // Cap count at maximum
        if (normalizedCount > LIMITS.MAX_PAGE_SIZE) {
            normalizedCount = LIMITS.MAX_PAGE_SIZE;
        }

        // Validate afterReference if provided
        if (afterReference && !FhirReferenceParser.isValid(afterReference)) {
            throw new Error(`Invalid afterReference format: ${afterReference}`);
        }

        return {
            count: normalizedCount,
            afterReference: afterReference || null
        };
    }
}

module.exports = { GroupMemberBatchValidator };
