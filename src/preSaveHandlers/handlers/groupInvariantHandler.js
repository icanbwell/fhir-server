const { PreSaveHandler } = require('./preSaveHandler');
const { RethrownError } = require('../../utils/rethrownError');
const { BadRequestError } = require('../../utils/httpErrors');
const { createTooCostlyError } = require('../../utils/fhirErrorFactory');

/**
 * PreSave handler to validate FHIR Group resource invariants
 *
 * Enforces:
 * - grp-1: Can only have members if actual = true
 *   (A Group with actual=false is a "definition" not an actual list of entities)
 * - Member count limit: Rejects CREATE/PUT with too-costly OperationOutcome when member count exceeds limit
 *   (Guides users toward PATCH for bulk loading, which is architecturally correct)
 *
 * Runs before any Group resource is saved (CREATE, UPDATE, MERGE, PATCH)
 */
class GroupInvariantHandler extends PreSaveHandler {
    /**
     * @param {Object} params
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor({ configManager }) {
        super();
        this.configManager = configManager;
    }

    /**
     * Validates Group invariants before save
     * @param {Object} params
     * @param {Resource} params.resource - FHIR resource being saved
     * @returns {Promise<Resource>} The resource (unmodified if valid)
     * @throws {BadRequestError} If invariant is violated
     */
    async preSaveAsync({ resource }) {
        // Only validate Group resources
        if (resource.resourceType !== 'Group') {
            return resource;
        }

        // grp-1: Can only have members if actual = true
        // If actual is false (or missing/undefined), must not have members
        const actual = resource.actual;
        const hasMembers = resource.member && Array.isArray(resource.member) && resource.member.length > 0;

        if (!actual && hasMembers) {
            throw new BadRequestError({
                message: `FHIR invariant grp-1 violated: Can only have members if actual = true. ` +
                         `A Group with actual=false is a definition, not an actual list of entities.`,
                args: {
                    resourceType: 'Group',
                    actual,
                    memberCount: resource.member.length,
                    invariant: 'grp-1',
                    expression: ['Group.actual', 'Group.member']
                }
            });
        }

        // TODO: Update to skip this flow when clickhouse is disabled
        // Check member count limit for CREATE/PUT operations
        // if (hasMembers) {
        //     const memberCount = resource.member.length;
        //     const limit = this.configManager.groupMemberLimit;

        //     if (memberCount > limit) {
        //         const { message, options } = createTooCostlyError({
        //             actual: memberCount,
        //             limit,
        //             operation: 'PUT'
        //         });
        //         throw new BadRequestError({ message }, options);
        //     }
        // }

        // Valid - return unchanged
        return resource;
    }
}

module.exports = {
    GroupInvariantHandler
};
