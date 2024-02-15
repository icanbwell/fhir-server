const {BaseConverter} = require('./baseConverter');

class ProcedureConverter extends BaseConverter {
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            code,
            subject,
            performedDateTime,
            performer,
            location
        } = resource;

        const statusText = this.getDisplayText(status.coding);
        const codeText = this.getDisplayText(code.coding);
        const subjectReference = subject && subject.reference ? subject.reference : 'N/A';
        const performedDate = performedDateTime ? this.formatDate(performedDateTime) : 'N/A';
        const performerText = performer && performer.display ? performer.display : 'N/A';
        const locationText = location && location.display ? location.display : 'N/A';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Code: ${codeText}
- Subject Reference: ${subjectReference}
- Performed Date: ${performedDate}
- Performer: ${performerText}
- Location: ${locationText}
`;

        return formattedOutput;
    }
}

module.exports = {
    ProcedureConverter
};
