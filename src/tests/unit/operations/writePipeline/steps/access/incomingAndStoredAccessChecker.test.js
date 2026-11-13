const { describe, test, expect, jest } = require('@jest/globals');
const { IncomingAndStoredAccessChecker } = require('../../../../../../operations/writePipeline/steps/access/incomingAndStoredAccessChecker');
const { WriteAllowedByScopesValidator } = require('../../../../../../operations/merge/validators/writeAllowedByScopesValidator');
const { MergeResultEntry } = require('../../../../../../operations/common/mergeResultEntry');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');

/**
 * A `_uuid` that two items share.
 */
const SHARED_UUID = '00000000-0000-4000-8000-00000000000a';
/**
 * A `_uuid` that one item has alone.
 */
const OTHER_UUID = '00000000-0000-4000-8000-00000000000b';

/**
 * Builds a Patient item with the given index, id and `_uuid`.
 */
const buildItem = ({ index, id, uuid }) => new WriteItem({
    index,
    incoming: { resourceType: 'Patient', id, _uuid: uuid, _sourceAssigningAuthority: 'client' }
});

/**
 * Builds the validator's forbidden error entry for the resource, with one `forbidden` issue with
 * the given text.
 */
const buildForbiddenEntry = ({ resource, text }) => {
    const issue = { severity: 'error', code: 'forbidden', details: { text }, diagnostics: text };
    return new MergeResultEntry({
        id: resource.id,
        uuid: resource._uuid,
        resourceType: resource.resourceType,
        created: false,
        updated: false,
        operationOutcome: { resourceType: 'OperationOutcome', issue: [issue] },
        issue
    });
};

describe('IncomingAndStoredAccessChecker', () => {
    test('gives each forbidden item its own error when items share a uuid and resource type', async () => {
        const items = [
            buildItem({ index: 0, id: 'synthetic-1', uuid: SHARED_UUID }),
            buildItem({ index: 1, id: 'synthetic-2', uuid: OTHER_UUID }),
            buildItem({ index: 2, id: SHARED_UUID, uuid: SHARED_UUID })
        ];
        const firstError = buildForbiddenEntry({ resource: items[0].incoming, text: 'first synthetic denial' });
        const secondError = buildForbiddenEntry({ resource: items[2].incoming, text: 'second synthetic denial' });
        const writeAllowedByScopesValidator = Object.create(WriteAllowedByScopesValidator.prototype);
        writeAllowedByScopesValidator.validate = jest.fn(async () => ({
            validatedObjects: [items[1].incoming],
            preCheckErrors: [firstError, secondError],
            wasAList: false
        }));
        const checker = new IncomingAndStoredAccessChecker({ writeAllowedByScopesValidator });
        const context = new WriteContext({
            requestInfo: { requestId: 'synthetic-request' },
            base_version: '4_0_0',
            parsedArgs: {},
            smartMerge: true,
            operationName: 'merge'
        });

        const failures = await checker.checkAsync({ items, context });

        expect(writeAllowedByScopesValidator.validate).toHaveBeenCalledWith({
            requestInfo: context.requestInfo,
            incomingResources: items.map((item) => item.incoming),
            base_version: '4_0_0',
            effectiveSmartMerge: true
        });
        expect(failures).toStrictEqual([
            new WriteFailure({
                stage: WRITE_FAILURE_STAGE.ACCESS,
                subject: { id: 'synthetic-1', uuid: SHARED_UUID, sourceAssigningAuthority: undefined, resourceType: 'Patient' },
                operationOutcome: firstError.operationOutcome
            }),
            null,
            new WriteFailure({
                stage: WRITE_FAILURE_STAGE.ACCESS,
                subject: { id: SHARED_UUID, uuid: SHARED_UUID, sourceAssigningAuthority: undefined, resourceType: 'Patient' },
                operationOutcome: secondError.operationOutcome
            })
        ]);
    });
});
