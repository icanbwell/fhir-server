const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

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
            authoredOn,
        } = resource;

        const statusText = getDisplayText(status.coding);
        const medicationText = getDisplayText(medicationCodeableConcept.coding);
        const subjectReference = subject ? subject.reference : '';
        const dosageInstructionText = dosageInstruction ? dosageInstruction.text : '';
        const whenHandedOverText = whenHandedOver ? formatDate(whenHandedOver) : '';
        const performerText = performer ? performer.display : '';
        const authoredOnText = authoredOn ? formatDate(authoredOn) : '';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
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
