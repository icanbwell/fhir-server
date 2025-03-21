// Autogenerated by script: generate_search_parameters.py.  Do not edit.
/**
 * @name exports
 * @static
 * @summary Arguments for the EventDefinition query
 */
module.exports = {
  'composed-of': {
    type: 'reference',
    fhirtype: 'reference',
    xpath: 'EventDefinition.relatedArtifact[type/@value=\'composed-of\'].resource',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-composed-of',
    description: 'What resource is being referenced'
  },
  context: {
    type: 'token',
    fhirtype: 'token',
    xpath: 'EventDefinition.useContext.valueCodeableConcept',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-context',
    description: 'A use context assigned to the event definition'
  },
  'context-quantity': {
    type: 'quantity',
    fhirtype: 'quantity',
    xpath: 'EventDefinition.useContext.valueQuantity',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-context-quantity',
    description: 'A quantity- or range-valued use context assigned to the event definition'
  },
  'context-type': {
    type: 'token',
    fhirtype: 'token',
    xpath: 'EventDefinition.useContext.code',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-context-type',
    description: 'A type of use context assigned to the event definition'
  },
  date: {
    type: 'date',
    fhirtype: 'date',
    xpath: 'EventDefinition.date',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-date',
    description: 'The event definition publication date'
  },
  'depends-on': {
    type: 'reference',
    fhirtype: 'reference',
    xpath: 'EventDefinition.relatedArtifact[type/@value=\'depends-on\'].resource',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-depends-on',
    description: 'What resource is being referenced'
  },
  'derived-from': {
    type: 'reference',
    fhirtype: 'reference',
    xpath: 'EventDefinition.relatedArtifact[type/@value=\'derived-from\'].resource',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-derived-from',
    description: 'What resource is being referenced'
  },
  description: {
    type: 'string',
    fhirtype: 'string',
    xpath: 'EventDefinition.description',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-description',
    description: 'The description of the event definition'
  },
  effective: {
    type: 'date',
    fhirtype: 'date',
    xpath: 'EventDefinition.effectivePeriod',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-effective',
    description: 'The time during which the event definition is intended to be in use'
  },
  identifier: {
    type: 'token',
    fhirtype: 'token',
    xpath: 'EventDefinition.identifier',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-identifier',
    description: 'External identifier for the event definition'
  },
  jurisdiction: {
    type: 'token',
    fhirtype: 'token',
    xpath: 'EventDefinition.jurisdiction',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-jurisdiction',
    description: 'Intended jurisdiction for the event definition'
  },
  name: {
    type: 'string',
    fhirtype: 'string',
    xpath: 'EventDefinition.name',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-name',
    description: 'Computationally friendly name of the event definition'
  },
  predecessor: {
    type: 'reference',
    fhirtype: 'reference',
    xpath: 'EventDefinition.relatedArtifact[type/@value=\'predecessor\'].resource',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-predecessor',
    description: 'What resource is being referenced'
  },
  publisher: {
    type: 'string',
    fhirtype: 'string',
    xpath: 'EventDefinition.publisher',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-publisher',
    description: 'Name of the publisher of the event definition'
  },
  status: {
    type: 'token',
    fhirtype: 'token',
    xpath: 'EventDefinition.status',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-status',
    description: 'The current status of the event definition'
  },
  successor: {
    type: 'reference',
    fhirtype: 'reference',
    xpath: 'EventDefinition.relatedArtifact[type/@value=\'successor\'].resource',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-successor',
    description: 'What resource is being referenced'
  },
  title: {
    type: 'string',
    fhirtype: 'string',
    xpath: 'EventDefinition.title',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-title',
    description: 'The human-friendly name of the event definition'
  },
  topic: {
    type: 'token',
    fhirtype: 'token',
    xpath: 'EventDefinition.topic',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-topic',
    description: 'Topics associated with the module'
  },
  url: {
    type: 'uri',
    fhirtype: 'uri',
    xpath: 'EventDefinition.url',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-url',
    description: 'The uri that identifies the event definition'
  },
  version: {
    type: 'token',
    fhirtype: 'token',
    xpath: 'EventDefinition.version',
    definition: 'http://hl7.org/fhir/SearchParameter/EventDefinition-version',
    description: 'The business version of the event definition'
  }
};
