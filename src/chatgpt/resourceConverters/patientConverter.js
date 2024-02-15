const {BaseConverter} = require('./baseConverter');

class PatientConverter extends BaseConverter {
    /**
     * converts Patient resource to text
     * @param {Resource} resource
     * @returns {string}
     */
    convert({resource}) {
        const {
            id,
            meta: {lastUpdated, source},
            language,
            extension,
            identifier,
            // active,
            name,
            telecom,
            gender,
            birthDate,
            address,
            maritalStatus,
            multipleBirthBoolean,
            communication
        } = resource;

        const fullName = name && name.length > 0 && name[0].given && name[0].given.length > 0 ? `${name[0].given[0]} ${name[0].family} ` : 'unknown';
        const race = extension && extension.find((ext) => ext.url === 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race');
        const ethnicity = extension && extension.find((ext) => ext.url === 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity');
        const birthPlace = extension && address.find((addr) => addr.url === 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace');

        const formattedRace = race && race.extension && race.extension.find((ext) => ext.url === 'text').valueString;
        const formattedEthnicity = ethnicity && ethnicity.extension.find((ext) => ext.url === 'text').valueString;

        const formattedAddress = address && address.map((addr) => `${addr.line.join(' ')}, ${addr.city}, ${addr.state}, ${addr.country}`).join(', ');

        const formattedTelecom = telecom && telecom.map((contact) => `${contact.system}: ${contact.value} (${contact.use})`).join(', ');

        const formattedMaritalStatus = maritalStatus && maritalStatus.coding[0].display;

        const formattedMultipleBirth = multipleBirthBoolean ? 'Yes' : 'No';

        const communicationLanguage = communication && communication.length > 0 &&
            communication[0].language?.coding.length > 0 &&
            communication[0].language?.coding[0].display;

        /**
         * @type {string[]}
         */
        const safeIdentifiers = identifier ? identifier.map((id1) => `${id1.system}: ${id1.display} : ${id1.value}`) : [];
        // noinspection UnnecessaryLocalVariableJS
        const disabilityAdjustedLifeYears = extension && extension.find((ext) => ext.url === 'http://synthetichealth.github.io/synthea/disability-adjusted-life-years')?.valueDecimal;
        const qualityAdjustedLifeYears = extension && extension.find((ext) => ext.url === 'http://synthetichealth.github.io/synthea/quality-adjusted-life-years')?.valueDecimal;

        const formattedOutput = `
- Resource: Patient
- ID: ${id}
- Name: ${fullName}
- Last Updated: ${new Date(lastUpdated).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'})}
- Source: ${source}
- Language: ${language}
- Race: ${formattedRace}
- Ethnicity: ${formattedEthnicity}
- Gender: ${gender}
- Birth Date: ${new Date(birthDate).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'})}
- Birth Place: ${(birthPlace && birthPlace.valueAddress ? birthPlace.valueAddress.city : undefined)}, ${(birthPlace && birthPlace.valueAddress ? birthPlace.valueAddress.state : undefined)}, ${(birthPlace && birthPlace.valueAddress ? birthPlace.valueAddress.country : undefined)}
- Disability Adjusted Life Years: ${disabilityAdjustedLifeYears}
- Quality Adjusted Life Years: ${qualityAdjustedLifeYears}
- Marital Status: ${formattedMaritalStatus}
- Multiple Birth: ${formattedMultipleBirth}
- Communication Language: ${communicationLanguage}
- Identifier: ${safeIdentifiers.join('\n')}
- Contact Information: ${formattedTelecom}
- Address: ${formattedAddress}
`;

        return formattedOutput;
    }
}

module.exports = {
    PatientConverter
};
