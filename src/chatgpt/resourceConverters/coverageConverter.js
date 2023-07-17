const {BaseConverter} = require('./baseConverter');

function getDisplayText(codingArray) {
    const coding = codingArray.find((item) => item.display);
    return coding ? coding.display : '';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

class CoverageConverter extends BaseConverter {
    convert({resource}) {
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
            relationship,
        } = resource;

        const statusText = getDisplayText(status.coding);
        const beneficiaryText = beneficiary ? beneficiary.reference : '';
        const payorText = payor ? payor.map((p) => p.display).join(', ') : '';
        const classText = coverageClass ? coverageClass.type.text : '';
        const periodStart = period ? formatDate(period.start) : '';
        const periodEnd = period ? formatDate(period.end) : '';
        const relationshipText = relationship ? getDisplayText(relationship.coding) : '';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Last Updated: ${formatDate(lastUpdated)}
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
