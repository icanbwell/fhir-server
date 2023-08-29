const {BaseConverter} = require('./baseConverter');

class PatientConverter extends BaseConverter {
    /**
     * converts Patient resource to text
     * @param {Resource} resource
     * @returns {Promise<string>}
     */
    async convertAsync({resource}) {
        const patient = /** @type {Patient} */ resource;
        const {
            id,
            meta: {lastUpdated, source},
            /** @type {Extension[]} */
            extension,
            identifier,
            // active,
            /** @type {HumanName[]} */
            name,
            telecom,
            gender,
            birthDate,
            address,
            maritalStatus,
            communication,
            resourceType
        } = patient;

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

        // Patient specific properties
        textArray = textArray.concat(
            this.getDate({title: 'Birth Date', date: birthDate})
        );

        textArray = textArray.concat(
            this.getText({title: 'Gender', text: gender})
        );

        textArray = textArray.concat(
            this.getName({title: 'Name', name})
        );

        textArray = textArray.concat(this.getExtensionValue(
                {
                    title: 'Race',
                    extension,
                    url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race'
                }
            )
        );

        textArray = textArray.concat(this.getExtensionValue(
                {
                    title: 'Ethnicity',
                    extension,
                    url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity'
                }
            )
        );

        textArray = textArray.concat(this.getExtensionValue(
                {
                    title: 'Birth Place',
                    extension,
                    url: 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace'
                }
            )
        );

        textArray = textArray.concat(
            this.getAddresses({title: 'Addresses', address})
        );

        textArray = textArray.concat(
            this.getContactPoint({title: 'Telecom', contactPoint: telecom})
        );

        textArray = textArray.concat(
            this.getCodeableConcept(
                {
                    title: 'Marital Status',
                    codeableConcept: maritalStatus,
                }
            )
        );

        textArray = textArray.concat(
            this.getCodeableConcept(
                {
                    title: 'Communication',
                    codeableConcept: communication,
                }
            )
        );

        const formattedOutput = textArray.join('\n');
        return formattedOutput;
    }
}

module.exports = {
    PatientConverter
};
