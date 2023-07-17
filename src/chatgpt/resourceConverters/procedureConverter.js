const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

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
            location,
        } = resource;

        const statusText = getDisplayText(status.coding);
        const codeText = getDisplayText(code.coding);
        const subjectReference = subject && subject.reference ? subject.reference : 'N/A';
        const performedDate = performedDateTime ? formatDate(performedDateTime) : 'N/A';
        const performerText = performer && performer.display ? performer.display : 'N/A';
        const locationText = location && location.display ? location.display : 'N/A';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
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
