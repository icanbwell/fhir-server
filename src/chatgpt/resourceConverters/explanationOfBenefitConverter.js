const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

class ExplanationOfBenefitConverter extends BaseConverter {
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            type,
            patient,
            provider,
            billablePeriod,
            total,
            item,
            payment,
        } = resource;

        const statusText = getDisplayText(status.coding);
        const typeText = getDisplayText(type.coding);
        const totalAmount = total.currency + ' ' + total.value;
        const paymentAmount = payment.amount.currency + ' ' + payment.amount.value;

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Type: ${typeText}
- Patient: ${patient.reference}
- Provider: ${provider.reference}
- Billable Period: ${formatDate(billablePeriod.start)} to ${formatDate(billablePeriod.end)}
- Total: ${totalAmount}
- Payment Amount: ${paymentAmount}
- Items: ${item.map((i) => i.productOrService.text).join(', ')}
`;

        return formattedOutput;
    }
}

module.exports = {
    ExplanationOfBenefitConverter
};
