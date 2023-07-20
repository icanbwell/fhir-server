const {BaseConverter} = require('./baseConverter');

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

        const statusText = this.getDisplayText(status.coding);
        const vaccineCodeText = this.getDisplayText(vaccineCode.coding);

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Vaccine Code: ${vaccineCodeText}
- Patient Reference: ${patient && patient.reference}
- Occurrence Date: ${this.formatDate(occurrenceDateTime)}
- Performer: ${(performer && performer.display ? performer.display : 'N/A')}
`;

        return formattedOutput;
    }
}

module.exports = {
    ImmunizationConverter
};
