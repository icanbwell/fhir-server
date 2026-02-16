const CodeableConcept = require('../../../fhir/classes/4_0_0/complex_types/codeableConcept');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { BaseValidator } = require('./baseValidator');
const { MergeResultEntry } = require('../../common/mergeResultEntry');

/**
 * Validates FHIR Group resource invariants
 *
 * Enforces:
 * - grp-1: Can only have members if actual = true
 *   (A Group with actual=false is a "definition" not an actual list of entities)
 */
class GroupInvariantValidator extends BaseValidator {
    /**
     * @param {FhirRequestInfo} requestInfo
     * @param {string} currentOperationName
     * @param {Resource|Resource[]} incomingResources
     * @param {string} base_version
     * @returns {Promise<{preCheckErrors: MergeResultEntry[], validatedObjects: Resource[], wasAList: boolean}>}
     */
    async validate({ requestInfo, currentOperationName, incomingResources, base_version }) {
        const errors = [];
        const wasAList = Array.isArray(incomingResources);
        const resources = wasAList ? incomingResources : [incomingResources];

        // Validate each Group resource
        for (const resource of resources) {
            if (resource.resourceType === 'Group') {
                const error = this._validateGroupInvariants(resource);
                if (error) {
                    errors.push(error);
                }
            }
        }

        // If there are validation errors, return them
        if (errors.length > 0) {
            return {
                validatedObjects: [],
                preCheckErrors: errors,
                wasAList
            };
        }

        // All valid, pass through
        return {
            validatedObjects: resources,
            preCheckErrors: [],
            wasAList
        };
    }

    /**
     * Validate Group resource invariants
     * @param {Object} resource - FHIR Group resource
     * @returns {OperationOutcome|null} Error if invalid, null if valid
     * @private
     */
    _validateGroupInvariants(resource) {
        // grp-1: Can only have members if actual = true
        // If actual is false (or missing, which defaults to false), must not have members
        const actual = resource.actual;
        const hasMembers = resource.member && Array.isArray(resource.member) && resource.member.length > 0;

        if (!actual && hasMembers) {
            return new OperationOutcome({
                id: 'invariant-violation',
                resourceType: 'OperationOutcome',
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invariant',
                        details: new CodeableConcept({
                            text: 'FHIR invariant grp-1 violated: Can only have members if actual = true. ' +
                                  'A Group with actual=false is a definition, not an actual list of entities.'
                        }),
                        diagnostics: `Group.actual=${actual}, Group.member.length=${resource.member.length}`,
                        expression: ['Group.actual', 'Group.member']
                    })
                ]
            });
        }

        return null;
    }
}

module.exports = {
    GroupInvariantValidator
};
