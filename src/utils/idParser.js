
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const {NotValidatedError} = require('./httpErrors');

class IdParser {
    /**
     * Parses id string
     * The id can be '123|medstar' or '123'
     * @param {string} id
     * @return {{ id: string, sourceAssigningAuthority: string|undefined}}
     * @throws NotValidatedError
     */
    static parse(id) {
        let id1;
        let sourceAssigningAuthority;
        let idParts = [];
        if (id && typeof id === 'string') {
            idParts = id.split('|');
        } else {
            const operationOutcome = new OperationOutcome({
                id: 'validationfail',
                resourceType: 'OperationOutcome',
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'structure',
                        details: new CodeableConcept({
                            text: `Invalid parameter id = ${id}`
                        })
                    })
                ]
            });
            throw new NotValidatedError(operationOutcome);
        }
        if (idParts.length > 1) {
            id1 = idParts[0];
            sourceAssigningAuthority = idParts[1];
        } else {
            id1 = id;
        }

        return {id: id1, sourceAssigningAuthority};
    }

}

module.exports = {
    IdParser
};
