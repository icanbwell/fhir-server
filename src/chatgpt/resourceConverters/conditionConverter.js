const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

class ConditionConverter extends BaseConverter {
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            clinicalStatus,
            verificationStatus,
            category,
            code,
            subject,
            onsetPeriod,
            recordedDate,
        } = resource;

        const clinicalStatusText = getDisplayText(clinicalStatus.coding);
        const verificationStatusText = getDisplayText(verificationStatus.coding);
        const categoryText = category.map((cat) => getDisplayText(cat.coding)).join(', ');

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
- Source: ${source}
- Clinical Status: ${clinicalStatusText}
- Verification Status: ${verificationStatusText}
- Category: ${categoryText}
- Code: ${getDisplayText(code.coding)} (${code.text})
- Subject Reference: ${subject.reference}
- Onset Period: ${formatDate(onsetPeriod.start)} to ${formatDate(onsetPeriod.end)}
- Recorded Date: ${formatDate(recordedDate)}
`;

        return formattedOutput;
    }
}

module.exports = {
    ConditionConverter
};
