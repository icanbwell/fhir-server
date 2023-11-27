/* eslint-disable no-unused-vars */
const { default: axios } = require('axios');
const { response } = require('express');
const { Fhir } = require('fhir');

var ParseConformance = require('fhir').ParseConformance;
var FhirVersions = require('fhir').Versions;
const fs = require('fs');
const { structuredefinition } = require('./src/fhir/classes/4_0_0/resources');

var observation = fs.readFileSync('./observation.json').toString();
var heartrate = fs.readFileSync('./heartrate.json').toString();

async function main() {
    // Get the data, downloaded it from: https://build.fhir.org/downloads.html
    let newValueSets = JSON.parse(
        fs
            .readFileSync('/home/rohit/Downloads/definitions.json/valuesets.json')
            .toString()
    );
    let newTypes = JSON.parse(
        fs
            .readFileSync('/home/rohit/Downloads/definitions.json/profiles-types.json')
            .toString()
    );
    let newResources = JSON.parse(
        fs
            .readFileSync('/home/rohit/Downloads/definitions.json/profiles-resources.json')
            .toString()
    );

    // Create a parser and parse it using the parser
    let parser = new ParseConformance(true, FhirVersions.R4);

    parser.parseBundle(newValueSets);
    parser.parseBundle(newTypes);
    parser.parseBundle(newResources);

    // Fetching heartrate profile data and adding it in structuredefinition
    let res = await axios.get('https://hl7.org/fhir/R4/heartrate.profile.json');
    parser.parseStructureDefinition(res.data);

    // Passing parser so as to include custom valuesets & structure definitions.
    // But not neccessary in case of v4.
    const v = new Fhir(parser);

    // The json has incorrect data of property: valueQuantity,
    // even though the package's validation method doesn't raise this issue.
    const result = v.validate(JSON.parse(heartrate));
    console.log('result', result);
}

main();
