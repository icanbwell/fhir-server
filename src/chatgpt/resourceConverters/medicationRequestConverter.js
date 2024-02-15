const {BaseConverter} = require('./baseConverter');


class MedicationRequestConverter extends BaseConverter {
    convert ({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            intent,
            medicationCodeableConcept,
            subject,
            authoredOn,
            dosageInstruction
        } = resource;

        const statusText = this.getDisplayText(status.coding);
        const intentText = this.getDisplayText(intent.coding);
        const medicationText = this.getDisplayText(medicationCodeableConcept.coding);

        const dosageInstructionsText = dosageInstruction && dosageInstruction
            .map((instruction) => instruction.text)
            .join(', ');

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Intent: ${intentText}
- Medication: ${medicationText}
- Subject Reference: ${subject.reference}
- Authored On: ${this.formatDate(authoredOn)}
- Dosage Instructions: ${dosageInstructionsText}
`;

        return formattedOutput;
    }
}

module.exports = {
    MedicationRequestConverter
};
