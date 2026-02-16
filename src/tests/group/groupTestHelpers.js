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

module.exports = {
    assertTooCostlyOperationOutcome,
    getMaxGroupMembersPerPut,
    getMaxPatchOperations
};
