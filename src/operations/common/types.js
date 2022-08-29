/**
 * @typedef Meta
 * @type {object}
 * @property {string} versionId - an ID.
 * @property {Date} lastUpdated
 * @property {string} source
 * @property {{system: string, code: string, display: string}[]} tag
 */

/**
 * @typedef Resource
 * @type {object}
 * @property {string} id - an ID.
 * @property {Meta} meta
 * @property {string} resourceType
 * @property {Object} _access
 */

/**
 * @typedef Coding
 * @description from https://www.hl7.org/fhir/operationoutcome.html
 * @type {object}
 * @property {string} [system]
 * @property {string} [code]
 * @property {string} [version]
 * @property {string} [display]
 */

/**
 * @typedef CodeableConcept
 * @description from https://www.hl7.org/fhir/datatypes.html#CodeableConcept
 * @type {object}
 * @property {Coding[]} [coding]
 * @property {string} [text]
 */

/**
 * @typedef OperationOutcomeIssue
 * @description from https://www.hl7.org/fhir/operationoutcome.html
 * @type {object}
 * @property {string} severity
 * @property {string} code
 * @property {CodeableConcept} [details]
 * @property {string|undefined} [diagnostics]
 * @property {string[]|undefined} [expression]
 */

/**
 * @typedef OperationOutcome
 * @type {object}
 * @property {string} [id]
 * @property {string} resourceType
 * @property {OperationOutcomeIssue[]} issue
 */


/**
 * @typedef SearchParameterDefinition
 * @type {object}
 * @property {string | null} field
 * @property {string[] | null} fields
 * @property {string | null} fieldFilter
 * @property {string | null} description
 * @property {string | null} type
 * @property {string[] | null} target
 */

/**
 * @typedef MergeResultEntry
 * @type {object}
 * @property {OperationOutcome|null|undefined} operationOutcome
 * @property {OperationOutcomeIssue|null|undefined} issue
 * @property {boolean} created
 * @property {string} id
 * @property {string} resourceType
 * @property {boolean} updated
 */

/**
 * @typedef GraphQLContext
 * @type {object}
 * @property {import('http').IncomingMessage} req
 * @property {import('http').ServerResponse} res
 * @property {FhirRequestInfo} fhirRequestInfo
 * @property {FhirDataSource} dataApi
 */

/**
 * @typedef BundleEntry
 * @description https://www.hl7.org/fhir/bundle.html
 * @type {object}
 * @property {Resource} resource
 * @property {string} [fullUrl]
 */


/**
 * @typedef Bundle
 * @description https://www.hl7.org/fhir/bundle.html
 * @type {object}
 * @property {string} [id] - an ID.
 * @property {string} type
 * @property {Meta} [meta]
 * @property {string} resourceType
 * @property {BundleEntry[]} entry
 * @property {string} [timestamp]
 */
