const { expect } = require('@jest/globals');

/**
 * Asserts that response contains a FHIR-compliant too-costly OperationOutcome
 * @param {Object} response - HTTP response
 * @param {number} actualCount - Actual count that exceeded limit
 * @param {number} configuredLimit - Configured limit
 */
function assertTooCostlyOperationOutcome(response, actualCount, configuredLimit) {
    expect(response.status).toBe(400);
    expect(response.body.resourceType).toBe('OperationOutcome');
    expect(response.body.issue).toBeDefined();
    expect(Array.isArray(response.body.issue)).toBe(true);
    expect(response.body.issue.length).toBeGreaterThan(0);

    const issue = response.body.issue[0];
    expect(issue.severity).toBe('error');
    expect(issue.code).toBe('too-costly');

    // Verify counts are in diagnostics
    expect(issue.diagnostics).toContain(actualCount.toString());
    expect(issue.diagnostics).toContain(configuredLimit.toString());

    // Verify diagnostics is non-empty (guidance exists but don't check specific wording)
    expect(issue.diagnostics.length).toBeGreaterThan(100); // Reasonable threshold for guidance text
}

/**
 * Gets the configured limit from environment or defaults
 */
function getMaxGroupMembersPerPut() {
    return parseInt(process.env.MAX_GROUP_MEMBERS_PER_PUT || '50000', 10);
}

function getMaxPatchOperations() {
    return parseInt(process.env.GROUP_PATCH_OPERATIONS_LIMIT || '10000', 10);
}

/**
 * Creates multiple groups in parallel for performance testing
 * @param {Object} request - Supertest request object
 * @param {Array<Object>} groups - Array of group definitions
 * @param {Object} headers - Request headers
 * @param {Array<Object>} securityTags - Optional custom security tags (defaults to test-owner/test-access)
 * @param {number} batchSize - Number of groups to create in parallel (default: 10)
 * @returns {Promise<Array>} Array of responses
 */
async function bulkCreateGroups(request, groups, headers, securityTags = null, batchSize = 10) {
    const defaultSecurityTags = securityTags || [
        { system: 'https://www.icanbwell.com/owner', code: 'test-owner' },
        { system: 'https://www.icanbwell.com/access', code: 'test-access' }
    ];

    const allResponses = [];

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < groups.length; i += batchSize) {
        const batch = groups.slice(i, i + batchSize);
        const createPromises = batch.map(group =>
            request.post('/4_0_0/Group')
                .send({
                    resourceType: 'Group',
                    ...group,
                    meta: group.meta || {
                        source: 'http://test.com/Group',
                        security: defaultSecurityTags
                    }
                })
                .set(headers)
        );

        const batchResponses = await Promise.all(createPromises);
        allResponses.push(...batchResponses);
    }

    return allResponses;
}

module.exports = {
    assertTooCostlyOperationOutcome,
    getMaxGroupMembersPerPut,
    getMaxPatchOperations,
    bulkCreateGroups
};
