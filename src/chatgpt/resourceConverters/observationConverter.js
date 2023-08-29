const {BaseConverter} = require('./baseConverter');


class ObservationConverter extends BaseConverter {
    async convertAsync({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            identifier,
            status,
            category,
            code,
            effectiveDateTime,
            valueQuantity,
            valueCodeableConcept,
            valueString,
            valueBoolean,
            valueInteger,
            valueDateTime,
            interpretation,
            resourceType
        } = resource;

        let textArray = [
            '# ResourceType',
            `${resourceType}`,
            `## ${resourceType} ID`,
            `${id}`
        ];

        // https://github.github.com/gfm/

        textArray = textArray.concat(
            this.getDate({title: 'Last Updated', date: lastUpdated})
        );

        textArray = textArray.concat(
            this.getIdentifiers({title: 'Identifiers', identifier})
        );

        textArray = textArray.concat(
            this.getText({title: 'Source', source})
        );

        textArray = textArray.concat(
            this.getText({title: 'Status', text: status})
        );

        textArray = textArray.concat(
            this.getCodeableConcept({title: 'Category', codeableConcept: category})
        );

        textArray = textArray.concat(
            this.getCode({title: 'Code', text: code})
        );

        textArray = textArray.concat(
            this.getQuantity({title: 'Value', quantity: valueQuantity})
        );

        textArray = textArray.concat(
            this.getCodeableConcept({title: 'Value', codeableConcept: valueCodeableConcept})
        );

        textArray = textArray.concat(
            this.getText({title: 'Value', text: valueString})
        );

        textArray = textArray.concat(
            this.getText({title: 'Value', text: valueBoolean})
        );

        textArray = textArray.concat(
            this.getText({title: 'Value', text: valueInteger})
        );

        textArray = textArray.concat(
            this.getDate({title: 'Value', date: valueDateTime})
        );

        textArray = textArray.concat(
            this.getCodeableConcept({title: 'Interpretation', codeableConcept: interpretation})
        );

        textArray = textArray.concat(
            this.getDate({title: 'Effective Date/Time', date: effectiveDateTime})
        );

        const formattedOutput = textArray.join('\n');
        return formattedOutput;
    }
}

module.exports = {
    ObservationConverter
};
