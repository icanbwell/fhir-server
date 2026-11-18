const { describe, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { ResourceValidator } = require('../../../../../../operations/common/resourceValidator');
const { SourceAssigningAuthorityColumnHandler } = require('../../../../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { ParsedArgs } = require('../../../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../../../operations/query/queryParameterValue');
const { UrlIdentityResolver } = require('../../../../../../operations/writePipeline/steps/identify/urlIdentityResolver');
const { IdentifyStep } = require('../../../../../../operations/writePipeline/steps/identifyStep');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');

const OWNER_SYSTEM = 'https://www.icanbwell.com/owner';
const SAA_SYSTEM = 'https://www.icanbwell.com/sourceAssigningAuthority';
const ACCESS_SYSTEM = 'https://www.icanbwell.com/access';
const UUID_ID = '6f0c2b1e-3a4d-4c5e-9f60-718293a4b5c6';

/**
 * Builds parsed args whose original `id` argument is the given URL id, as the FHIR route gives it.
 * @param {string} urlId
 * @returns {ParsedArgs}
 */
const buildParsedArgs = (urlId) => new ParsedArgs({
    base_version: '4_0_0',
    parsedArgItems: [
        new ParsedArgsItem({
            queryParameter: 'id',
            queryParameterValue: new QueryParameterValue({ value: urlId, operator: '$and' }),
            propertyObj: undefined,
            modifiers: []
        })
    ]
});

/**
 * Builds the resolver with the real validator method and the real column handlers.
 * @returns {UrlIdentityResolver}
 */
const buildResolver = () => new UrlIdentityResolver({
    resourceValidator: Object.create(ResourceValidator.prototype),
    sourceAssigningAuthorityColumnHandler: new SourceAssigningAuthorityColumnHandler({
        configManager: new ConfigManager()
    }),
    uuidColumnHandler: new UuidColumnHandler()
});

/**
 * Runs the resolver through `IdentifyStep` for one item and returns what came out: the failure's
 * stage and its outcome text, or its error's status code, issue code, message and whether it is an
 * assertion, and the item's body.
 * @param {string} urlId
 * @param {Object} body
 * @returns {Promise<Object>}
 */
const resolve = async ({ urlId, body }) => {
    const item = new WriteItem({ index: 0, incoming: body });
    const context = new WriteContext({
        requestInfo: {},
        base_version: '4_0_0',
        parsedArgs: buildParsedArgs(urlId),
        smartMerge: false
    });
    await new IdentifyStep({ identityResolver: buildResolver() }).runAsync({ items: [item], context });
    const failure = item.failure;
    return {
        failure: failure && {
            stage: failure.stage,
            outcomeText: failure.operationOutcome?.issue[0].details.text,
            statusCode: failure.error?.statusCode,
            issueCode: failure.error?.issue?.[0].code,
            errorMessage: failure.error?.message,
            isAssertionError: failure.error?.name === 'AssertionError'
        },
        incoming: item.incoming
    };
};

/**
 * Builds a synthetic Patient body with the given id and security tags.
 * @param {string} id
 * @param {Object[]} security
 * @returns {Object}
 */
const patient = ({ id, security }) => ({
    resourceType: 'Patient',
    id,
    meta: { source: 'https://example.test/source', security },
    active: true
});

const ownerTags = [{ system: OWNER_SYSTEM, code: 'owner' }, { system: ACCESS_SYSTEM, code: 'owner' }];

describe('UrlIdentityResolver', () => {
    test.each([
        {
            name: 'a UUID id becomes _uuid and the body is otherwise unchanged',
            urlId: UUID_ID,
            body: patient({ id: UUID_ID, security: [{ system: ACCESS_SYSTEM, code: 'owner' }] }),
            expected: ({ body }) => ({ failure: null, incoming: { ...body, _uuid: UUID_ID } })
        },
        {
            name: 'a non-UUID id with an owner tag gets _uuid and _sourceAssigningAuthority from the id and the owner, without a new security tag',
            urlId: 'patient-1',
            body: patient({ id: 'patient-1', security: ownerTags }),
            expected: ({ body }) => ({
                failure: null,
                incoming: {
                    ...body,
                    _uuid: generateUUIDv5('patient-1|owner'),
                    _sourceAssigningAuthority: 'owner'
                }
            })
        },
        {
            name: 'a non-UUID id with a sourceAssigningAuthority tag derives the identity from it',
            urlId: 'patient-1',
            body: patient({
                id: 'patient-1',
                security: [...ownerTags, { system: SAA_SYSTEM, code: 'authority' }]
            }),
            expected: ({ body }) => ({
                failure: null,
                incoming: {
                    ...body,
                    _uuid: generateUUIDv5('patient-1|authority'),
                    _sourceAssigningAuthority: 'authority'
                }
            })
        },
        {
            name: 'a non-UUID id with no authority tag fails at IDENTITY with the missing-tag outcome',
            urlId: 'patient-1',
            body: patient({ id: 'patient-1', security: [{ system: ACCESS_SYSTEM, code: 'owner' }] }),
            expected: ({ body }) => ({
                failure: {
                    stage: WRITE_FAILURE_STAGE.IDENTITY,
                    outcomeText: 'Resource Patient/patient-1 is missing a security access tag with system: https://www.icanbwell.com/owner',
                    statusCode: undefined,
                    issueCode: undefined,
                    errorMessage: undefined,
                    isAssertionError: false
                },
                incoming: body
            })
        },
        {
            name: 'a URL authority that differs from the owner tag fails at IDENTITY with a 400 BadRequestError',
            urlId: 'patient-1|other',
            body: patient({ id: 'patient-1', security: ownerTags }),
            expected: ({ body }) => ({
                failure: {
                    stage: WRITE_FAILURE_STAGE.IDENTITY,
                    outcomeText: undefined,
                    statusCode: 400,
                    issueCode: 'invalid',
                    errorMessage: 'The sourceAssigningAuthority in the id (patient-1|other) does not match the owner/sourceAssigningAuthority tag of the resource (owner)',
                    isAssertionError: false
                },
                incoming: body
            })
        },
        {
            name: 'a URL authority that matches the owner tag resolves',
            urlId: 'patient-1|owner',
            body: patient({ id: 'patient-1', security: ownerTags }),
            expected: ({ body }) => ({
                failure: null,
                incoming: {
                    ...body,
                    _uuid: generateUUIDv5('patient-1|owner'),
                    _sourceAssigningAuthority: 'owner'
                }
            })
        },
        {
            name: 'an owner tag with no code throws, which fails at IDENTITY with the assertion',
            urlId: 'patient-1',
            body: patient({ id: 'patient-1', security: [{ system: OWNER_SYSTEM }] }),
            expected: ({ body }) => ({
                failure: {
                    stage: WRITE_FAILURE_STAGE.IDENTITY,
                    outcomeText: undefined,
                    statusCode: undefined,
                    issueCode: undefined,
                    errorMessage: 'sourceAssigningAuthority is null for Patient/patient-1',
                    isAssertionError: true
                },
                incoming: body
            })
        }
    ])('$name', async ({ urlId, body, expected }) => {
        const originalBody = deepcopy(body);

        const result = await resolve({ urlId, body });

        expect(result).toStrictEqual(expected({ body: originalBody }));
    });

    test.each([
        { name: 'the id argument with an authority', urlId: 'patient-1|owner', expected: { id: 'patient-1', sourceAssigningAuthority: 'owner' } },
        { name: 'the id argument without an authority', urlId: 'patient-1', expected: { id: 'patient-1', sourceAssigningAuthority: undefined } }
    ])('parseUrlId splits $name', ({ urlId, expected }) => {
        expect(UrlIdentityResolver.parseUrlId(buildParsedArgs(urlId))).toStrictEqual(expected);
    });
});
