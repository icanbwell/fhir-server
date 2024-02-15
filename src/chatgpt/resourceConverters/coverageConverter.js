const {BaseConverter} = require('./baseConverter');

class CoverageConverter extends BaseConverter {
    convert ({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            subscriberId,
            subscriberName,
            beneficiary,
            payor,
            'class': coverageClass,
            period,
            relationship
        } = resource;

        const statusText = this.getDisplayText(status.coding);
        const beneficiaryText = beneficiary ? beneficiary.reference : '';
        const payorText = payor ? payor.map((p) => p.display).join(', ') : '';
        const classText = coverageClass && coverageClass.type ? coverageClass.type.text : '';
        const periodStart = period ? this.formatDate(period.start) : '';
        const periodEnd = period ? this.formatDate(period.end) : '';
        const relationshipText = relationship ? this.getDisplayText(relationship.coding) : '';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Subscriber ID: ${subscriberId}
- Subscriber Name: ${subscriberName}
- Beneficiary: ${beneficiaryText}
- Payor: ${payorText}
- Class: ${classText}
- Coverage Period: ${periodStart} to ${periodEnd}
- Relationship: ${relationshipText}
`;

        return formattedOutput;
    }
}

module.exports = {
    CoverageConverter
};
