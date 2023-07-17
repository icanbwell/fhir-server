const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

class ImmunizationConverter extends BaseConverter {
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            vaccineCode,
            patient,
            occurrenceDateTime,
            performer,
        } = resource;

        const statusText = getDisplayText(status.coding);
        const vaccineCodeText = getDisplayText(vaccineCode.coding);

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Vaccine Code: ${vaccineCodeText}
- Patient Reference: ${patient.reference}
- Occurrence Date: ${formatDate(occurrenceDateTime)}
- Performer: ${(performer && performer.display ? performer.display : 'N/A')}
`;

        return formattedOutput;
    }
}

module.exports = {
    ImmunizationConverter
};
