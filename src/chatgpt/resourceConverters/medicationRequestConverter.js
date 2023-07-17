const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

class MedicationRequestConverter extends BaseConverter {
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            intent,
            medicationCodeableConcept,
            subject,
            authoredOn,
            dosageInstruction,
        } = resource;

        const statusText = getDisplayText(status.coding);
        const intentText = getDisplayText(intent.coding);
        const medicationText = getDisplayText(medicationCodeableConcept.coding);

        const dosageInstructionsText = dosageInstruction
            .map((instruction) => instruction.text)
            .join(', ');

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Intent: ${intentText}
- Medication: ${medicationText}
- Subject Reference: ${subject.reference}
- Authored On: ${formatDate(authoredOn)}
- Dosage Instructions: ${dosageInstructionsText}
`;

        return formattedOutput;
    }
}

module.exports = {
    MedicationRequestConverter
};
