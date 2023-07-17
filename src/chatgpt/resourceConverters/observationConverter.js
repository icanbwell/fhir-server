const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

class ObservationConverter extends BaseConverter {
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            category,
            code,
            subject,
            effectiveDateTime,
            valueQuantity,
            valueCodeableConcept,
            interpretation,
        } = resource;

        const statusText = getDisplayText(status.coding);
        const categoryText = getDisplayText(category[0].coding);
        const codeText = getDisplayText(code.coding);
        const subjectReference = subject.reference;

        let valueText = '';
        if (valueQuantity) {
            valueText = `${valueQuantity.value} ${valueQuantity.unit}`;
        } else if (valueCodeableConcept) {
            valueText = getDisplayText(valueCodeableConcept.coding);
        }

        const interpretationText = interpretation ? getDisplayText(interpretation.coding) : '';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Category: ${categoryText}
- Code: ${codeText}
- Subject Reference: ${subjectReference}
- Effective Date/Time: ${formatDate(effectiveDateTime)}
- Value: ${valueText}
- Interpretation: ${interpretationText}
`;

        return formattedOutput;
    }
}

module.exports = {
    ObservationConverter
};
