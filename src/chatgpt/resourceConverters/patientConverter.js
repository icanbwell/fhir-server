const {BaseConverter} = require('./baseConverter');

class PatientConverter extends BaseConverter{
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
            communication,
        } = resource;

        const fullName = name && name.length > 0 ? `${name[0].given[0]} ${name[0].family} ` : 'unknown';
        const race = extension.find((ext) => ext.url === 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race');
        const ethnicity = extension.find((ext) => ext.url === 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity');
        const birthPlace = address.find((addr) => addr.url === 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace');

        const formattedRace = race && race.extension.find((ext) => ext.url === 'text').valueString;
        const formattedEthnicity = ethnicity && ethnicity.extension.find((ext) => ext.url === 'text').valueString;

        const formattedAddress = address.map((addr) => `${addr.line.join(' ')}, ${addr.city}, ${addr.state}, ${addr.country}`).join(', ');

        const formattedTelecom = telecom.map((contact) => `${contact.system}: ${contact.value} (${contact.use})`).join(', ');

        const formattedMaritalStatus = maritalStatus && maritalStatus.coding[0].display;

        const formattedMultipleBirth = multipleBirthBoolean ? 'Yes' : 'No';

        const communicationLanguage = communication[0].language.coding[0].display;
        // noinspection UnnecessaryLocalVariableJS
        const formattedOutput = `
- ID: ${id}
- Name: ${fullName}
- Last Updated: ${new Date(lastUpdated).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'})}
- Source: ${source}
- Language: ${language}
- Race: ${formattedRace}
- Ethnicity: ${formattedEthnicity}
- Gender: ${gender}
- Birth Date: ${new Date(birthDate).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'})}
- Birth Place: ${birthPlace.valueAddress.city}, ${birthPlace.valueAddress.state}, ${birthPlace.valueAddress.country}
- Disability Adjusted Life Years: ${extension.find((ext) => ext.url === 'http://synthetichealth.github.io/synthea/disability-adjusted-life-years').valueDecimal}
- Quality Adjusted Life Years: ${extension.find((ext) => ext.url === 'http://synthetichealth.github.io/synthea/quality-adjusted-life-years').valueDecimal}
- Marital Status: ${formattedMaritalStatus}
- Multiple Birth: ${formattedMultipleBirth}
- Communication Language: ${communicationLanguage}
- Identifier: ${identifier.find((id1) => id1.type.coding[0].system === 'http://terminology.hl7.org/CodeSystem/v2-0203').type.coding[0].display} - ${identifier.find((id1) => id1.type.coding[0].system === 'http://terminology.hl7.org/CodeSystem/v2-0203').value}
- Contact Information: ${formattedTelecom}
- Address: ${formattedAddress}
`;

        return formattedOutput;
    }
}

module.exports = {
    PatientConverter
};
