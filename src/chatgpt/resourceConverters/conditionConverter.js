const {BaseConverter} = require('./baseConverter');

class ConditionConverter extends BaseConverter {
    convert ({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            clinicalStatus,
            verificationStatus,
            category,
            code,
            subject,
            onsetPeriod,
            recordedDate
        } = resource;

        const clinicalStatusText = this.getDisplayText(clinicalStatus && clinicalStatus.coding);
        const verificationStatusText = this.getDisplayText(verificationStatus && verificationStatus.coding);
        const categoryText = category && category.map((cat) => this.getDisplayText(cat.coding)).join(', ');

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- Resource: Condition
- ID: ${id}
- Patient: ${subject.reference}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Clinical Status: ${clinicalStatusText}
- Verification Status: ${verificationStatusText}
- Category: ${categoryText}
- Code: ${this.getDisplayText(code && code.coding)} (${code && code.text})
- Subject Reference: ${subject.reference}
- Onset Period: ${this.formatDate(onsetPeriod && onsetPeriod.start)} to ${this.formatDate(onsetPeriod && onsetPeriod.end)}
- Recorded Date: ${this.formatDate(recordedDate)}
`;

        return formattedOutput;
    }
}

module.exports = {
    ConditionConverter
};
