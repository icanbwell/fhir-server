/**
 * @typedef MergeResultEntry
 * @type {Object}
 * @property {OperationOutcome|undefined} [operationOutcome]
 * @property {OperationOutcomeIssue|undefined} [issue]
 * @property {boolean} created
 * @property {string} id
 * @property {string} resourceType
 * @property {boolean} updated
 */

/**
 * @typedef GraphQLContext
 * @type {Object}
 * @property {import('http').IncomingMessage} req
 * @property {import('http').ServerResponse} res
 * @property {FhirRequestInfo} fhirRequestInfo
 * @property {FhirDataSource} dataApi
 */

