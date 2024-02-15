const { BaseConverter } = require('./baseConverter');

class CarePlanConverter extends BaseConverter {
    convert ({ resource }) {
        const {
            id,
            meta: { lastUpdated, source },
            status,
            intent,
            category,
            subject,
            period,
            description,
            author,
            activity,
            addresses,
            note
        } = resource;

        const statusText = this.getDisplayText(status.coding);
        const intentText = this.getDisplayText(intent.coding);
        const categoryText = this.getDisplayText(category.coding);
        const subjectReference = subject.reference;
        const periodStart = this.formatDate(period.start);
        const periodEnd = this.formatDate(period.end);
        const descriptionText = description || '';
        const authorText = author ? author.display : '';
        const activityText = activity && activity.map((act) => act.detail.code.text).join(', ');
        const addressesText = addresses ? addresses.map((addr) => this.getDisplayText(addr.coding)).join(', ') : '';
        const noteText = note ? note[0].text : '';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Intent: ${intentText}
- Category: ${categoryText}
- Subject Reference: ${subjectReference}
- Period: ${periodStart} to ${periodEnd}
- Description: ${descriptionText}
- Author: ${authorText}
- Activity: ${activityText}
- Addresses: ${addressesText}
- Note: ${noteText}
`;

        return formattedOutput;
    }
}

module.exports = {
    CarePlanConverter
};
