const {BaseConverter} = require('./baseConverter');


class ObservationConverter extends BaseConverter {
    convert ({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            status,
            category,
            code,
            subject,
            effectiveDateTime,
            valueQuantity,
            valueCodeableConcept,
            interpretation
        } = resource;

        const statusText = this.getDisplayText(status.coding);
        const categoryText = this.getDisplayText(category && category.length > 0 && category[0].coding);
        const codeText = this.getDisplayText(code.coding);
        const subjectReference = subject ? subject.reference : undefined;

        let valueText = '';
        if (valueQuantity) {
            valueText = `${valueQuantity.value} ${valueQuantity.unit}`;
        } else if (valueCodeableConcept) {
            valueText = this.getDisplayText(valueCodeableConcept.coding);
        }

        const interpretationText = interpretation ? this.getDisplayText(interpretation.coding) : '';

        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- Resource: Observation
- ID: ${id}
- Last Updated: ${this.formatDate(lastUpdated)}
- Source: ${source}
- Status: ${statusText}
- Category: ${categoryText}
- Code: ${codeText}
- Subject Reference: ${subjectReference}
- Effective Date/Time: ${this.formatDate(effectiveDateTime)}
- Value: ${valueText}
- Interpretation: ${interpretationText}
`;

        return formattedOutput;
    }
}

module.exports = {
    ObservationConverter
};
