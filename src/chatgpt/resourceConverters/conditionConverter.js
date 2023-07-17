const {BaseConverter} = require('./baseConverter');

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

        const clinicalStatusText = this.getDisplayText(clinicalStatus.coding);
        const verificationStatusText = this.getDisplayText(verificationStatus.coding);
        const categoryText = category.map((cat) => this.getDisplayText(cat.coding)).join(', ');

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Clinical Status: ${clinicalStatusText}
- Verification Status: ${verificationStatusText}
- Category: ${categoryText}
- Code: ${this.getDisplayText(code.coding)} (${code.text})
- Subject Reference: ${subject.reference}
- Onset Period: ${this.formatDate(onsetPeriod.start)} to ${this.formatDate(onsetPeriod.end)}
- Recorded Date: ${this.formatDate(recordedDate)}
`;

        return formattedOutput;
    }
}

module.exports = {
    ConditionConverter
};
