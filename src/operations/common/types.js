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

// from https://www.hl7.org/fhir/operationoutcome.html
/**
 * @typedef OperationOutcomeIssue
 * @type {object}
 * @property {string} severity
 * @property {string} code
 * @property {{text: string}} details
 * @property {string|null} diagnostics
 * @property {string[]|null} expression
 */

/**
 * @typedef OperationOutcome
 * @type {object}
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
 * @property {OperationOutcome|null} operationOutcome
 * @property {OperationOutcomeIssue|null} issue
 * @property {boolean} created
 * @property {string} id
 * @property {string} resourceType
 * @property {boolean} updated
 */

