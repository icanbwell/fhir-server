const { FhirResourceWriteNormalizeSerializer } = require('../fhir/fhirResourceWriteNormalizeSerializer');

const buildOperationOutcomeFromIssues = (issues, id) =>
    FhirResourceWriteNormalizeSerializer.serialize({
        obj: { resourceType: 'OperationOutcome', ...(id !== undefined && { id }), issue: issues }
    });

const buildOperationOutcome = (...issues) => buildOperationOutcomeFromIssues(issues);

module.exports = {
    buildOperationOutcome,
    buildOperationOutcomeFromIssues
};
