const {BaseConverter} = require('./baseConverter');

class MedicationDispenseConverter extends BaseConverter {
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            medicationCodeableConcept,
            subject,
            dosageInstruction,
            whenHandedOver,
            performer,
            authoredOn
        } = resource;

        const statusText = this.getDisplayText(status.coding);
        const medicationText = this.getDisplayText(medicationCodeableConcept.coding);
        const subjectReference = subject ? subject.reference : '';
        const dosageInstructionText = dosageInstruction ? dosageInstruction.text : '';
        const whenHandedOverText = whenHandedOver ? this.formatDate(whenHandedOver) : '';
        const performerText = performer ? performer.display : '';
        const authoredOnText = authoredOn ? this.formatDate(authoredOn) : '';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Medication: ${medicationText}
- Subject Reference: ${subjectReference}
- Dosage Instruction: ${dosageInstructionText}
- Handed Over Date: ${whenHandedOverText}
- Performer: ${performerText}
- Authored On Date: ${authoredOnText}
`;

        return formattedOutput;
    }
}

module.exports = {
    MedicationDispenseConverter
};
