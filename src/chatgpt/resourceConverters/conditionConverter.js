const {BaseConverter} = require('./baseConverter');

class ConditionConverter extends BaseConverter {
    async convertAsync({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            identifier,
            clinicalStatus,
            verificationStatus,
            category,
            code,
            subject,
            onsetPeriod,
            recordedDate,
            resourceType
        } = resource;

        let textArray = [
            '# ResourceType',
            `${resourceType}`,
            '## Patient ID',
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

        // Condition specific properties
        textArray = textArray.concat(
            this.getReference({title: 'Patient', reference: subject})
        );
        textArray = textArray.concat(
            this.getCodeableConcept({title: 'Clinical Status', codeableConcept: clinicalStatus})
        );

        textArray = textArray.concat(
            this.getCodeableConcept({title: 'Verification Status', codeableConcept: verificationStatus})
        );

        textArray = textArray.concat(
            this.getCodeableConcept({title: 'Category', codeableConcept: category})
        );

        textArray = textArray.concat(
            this.getCodeableConcept({title: 'Code', codeableConcept: code})
        );

        textArray = textArray.concat(
            this.getDate({title: 'Recorded Date', date: recordedDate})
        );

        textArray = textArray.concat(
            this.getPeriod({title: 'Onset Period', period: onsetPeriod})
        );

        const formattedOutput = textArray.join('\n');
        return formattedOutput;
    }
}

module.exports = {
    ConditionConverter
};
