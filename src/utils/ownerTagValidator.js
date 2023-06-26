const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const { SecurityTagSystem } = require('./securityTagSystem');

/**
 * @description Validates if owner tag is present inside meta.security of a resource
 * @param {Object} resourceBody - payload of req.body
 * @returns {OperationOutcomeIssue|null} If payload does not contain owner tag raise OperationOutcomeIssue
 */
function validateOwnerTag(resourceBody) {
    if (!(resourceBody &&
        resourceBody.meta &&
        resourceBody.meta.security &&
        resourceBody.meta.security.some(s => s.system === SecurityTagSystem.owner))
    ) {
        return [
            new OperationOutcomeIssue({
                severity: 'error',
                code: 'invalid',
                details: new CodeableConcept({
                    text: `Resource ${resourceBody.resourceType}/${resourceBody.id}` +
                    ' is missing a security access tag with system: ' + `${SecurityTagSystem.owner}`
                }),
            }
        )];
    }
    return null;
}

module.exports = { validateOwnerTag };
