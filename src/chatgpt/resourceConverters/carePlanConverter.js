const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

class CarePlanConverter extends BaseConverter {
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            intent,
            category,
            subject,
            period,
            description,
            author,
            activity,
            addresses,
            note,
        } = resource;

        const statusText = getDisplayText(status.coding);
        const intentText = getDisplayText(intent.coding);
        const categoryText = getDisplayText(category.coding);
        const subjectReference = subject.reference;
        const periodStart = formatDate(period.start);
        const periodEnd = formatDate(period.end);
        const descriptionText = description || '';
        const authorText = author ? author.display : '';
        const activityText = activity.map((act) => act.detail.code.text).join(', ');
        const addressesText = addresses.map((addr) => getDisplayText(addr.coding)).join(', ');
        const noteText = note ? note[0].text : '';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
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
