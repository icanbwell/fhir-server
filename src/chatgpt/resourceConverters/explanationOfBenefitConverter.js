const {BaseConverter} = require('./baseConverter');

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
            payment
        } = resource;

        const statusText = this.getDisplayText(status.coding);
        const typeText = this.getDisplayText(type.coding);
        const totalAmount = total?.currency + ' ' + total?.value;
        const paymentAmount = payment?.amount?.currency + ' ' + payment?.amount?.value;

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Type: ${typeText}
- Patient: ${patient.reference}
- Provider: ${provider.reference}
- Billable Period: ${this.formatDate(billablePeriod.start)} to ${this.formatDate(billablePeriod.end)}
- Total: ${totalAmount}
- Payment Amount: ${paymentAmount}
- Items: ${item && item.map((i) => i.productOrService.text).join(', ')}
`;

        return formattedOutput;
    }
}

module.exports = {
    ExplanationOfBenefitConverter
};
