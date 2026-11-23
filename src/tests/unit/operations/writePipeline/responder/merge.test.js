const { describe, test, expect } = require('@jest/globals');
const { MergeResultEntry } = require('../../../../../operations/common/mergeResultEntry');
const { MergeResponder } = require('../../../../../operations/writePipeline/responder/merge');
const { BundleResourceValidator } = require('../../../../../operations/merge/validators/bundleResourceValidator');
const { ParametersResourceValidator } = require('../../../../../operations/merge/validators/parameterResourceValidator');
const { MergeManager } = require('../../../../../operations/merge/mergeManager');
const { ScopesManager } = require('../../../../../operations/security/scopesManager');
const { BundleManager } = require('../../../../../operations/common/bundleManager');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');
const { WriteItem } = require('../../../../../operations/writePipeline/writeItem');

/**
 * Builds a synthetic Patient failure subject numbered by `index`.
 */
const buildSubject = (index) => ({
    id: `item-${index}`,
    uuid: `00000000-0000-4000-8000-00000000000${index}`,
    sourceAssigningAuthority: 'client',
    resourceType: 'Patient'
});

/**
 * Builds an OperationOutcome with one `invalid` error issue with the given text.
 */
const buildOperationOutcome = (text) => ({
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'invalid', details: { text } }]
});

/**
 * Builds an item at `index` that failed at `stage` with a check failure.
 */
const buildFailedItem = ({ index, stage }) => {
    const item = new WriteItem({ index, incoming: { resourceType: 'Patient', id: `item-${index}` } });
    item.fail({
        failure: new WriteFailure({
            stage,
            subject: buildSubject(index),
            operationOutcome: buildOperationOutcome(`failure of item-${index}`)
        })
    });
    return item;
};

/**
 * A synthetic `_uuid`.
 */
const UUID_A = '00000000-0000-4000-8000-00000000000a';
/**
 * A second synthetic `_uuid`, different from `UUID_A`.
 */
const UUID_B = '00000000-0000-4000-8000-00000000000b';

/**
 * Builds a `$merge` result entry with the given fields.
 */
const buildEntry = ({ id, uuid, resourceType = 'Patient', created = false, updated = false, savedResource }) =>
    new MergeResultEntry({
        id,
        uuid,
        sourceAssigningAuthority: 'client',
        resourceType,
        created,
        updated,
        savedResource
    });

/**
 * Builds an item with the given identity, marked queued when `status` is 'queued' and unchanged
 * otherwise.
 */
const buildItemWithStatus = ({ index, uuid, id = `item-${index}`, resourceType = 'Patient', status }) => {
    const item = new WriteItem({
        index,
        incoming: { resourceType, id, _uuid: uuid, _sourceAssigningAuthority: 'client' }
    });
    if (status === 'queued') {
        item.markQueued();
    } else {
        item.markUnchanged();
    }
    return item;
};

/**
 * Builds a queued item.
 */
const buildQueuedItem = (props) => buildItemWithStatus({ ...props, status: 'queued' });

/**
 * Builds an unchanged item.
 */
const buildUnchangedItem = (props) => buildItemWithStatus({ ...props, status: 'unchanged' });

/**
 * A `MergeResponder` built on bare collaborator objects, enough for the methods under test.
 */
const responder = new MergeResponder({
    bundleResourceValidator: Object.create(BundleResourceValidator.prototype),
    parametersResourceValidator: Object.create(ParametersResourceValidator.prototype),
    mergeManager: Object.create(MergeManager.prototype),
    scopesManager: Object.create(ScopesManager.prototype),
    bundleManager: Object.create(BundleManager.prototype)
});

describe('MergeResponder', () => {
    test('failureResults puts request errors first, then each failed item in index order whatever its stage', () => {
        const items = [
            buildFailedItem({ index: 3, stage: WRITE_FAILURE_STAGE.STRUCTURE }),
            new WriteItem({ index: 2, incoming: { resourceType: 'Patient', id: 'item-2' } }),
            buildFailedItem({ index: 1, stage: WRITE_FAILURE_STAGE.WRITE }),
            buildUnchangedItem({ index: 4, uuid: UUID_A }),
            buildFailedItem({ index: 0, stage: WRITE_FAILURE_STAGE.SCOPE })
        ];
        const requestErrors = [buildEntry({ id: 'request-error' })];

        const results = responder.failureResults({ items, requestErrors });

        expect(results[0]).toBe(requestErrors[0]);
        expect(results.slice(1).map((result) => result.id)).toStrictEqual(['item-0', 'item-1', 'item-3']);
    });

    test.each([
        {
            name: 'a failed item gets its failure',
            build: () => {
                const item = buildFailedItem({ index: 0, stage: WRITE_FAILURE_STAGE.ACCESS });
                return { items: [item], executedResults: [], expected: [responder.toResult(item.failure)] };
            }
        },
        {
            name: 'an unchanged item gets a not modified entry',
            build: () => ({
                items: [buildUnchangedItem({ index: 0, uuid: UUID_A })],
                executedResults: [],
                expected: [buildEntry({ id: 'item-0', uuid: UUID_A })]
            })
        },
        {
            name: 'a queued item gets the executed result of its uuid and resource type',
            build: () => {
                const executedResult = buildEntry({
                    id: 'item-0', uuid: UUID_A, created: true, savedResource: { resourceType: 'Patient' }
                });
                return {
                    items: [buildQueuedItem({ index: 0, uuid: UUID_A })],
                    executedResults: [executedResult],
                    expected: [executedResult]
                };
            }
        },
        {
            name: 'a queued item without an executed result gets a not modified entry',
            build: () => ({
                items: [buildQueuedItem({ index: 0, uuid: UUID_A })],
                executedResults: [],
                expected: [buildEntry({ id: 'item-0', uuid: UUID_A })]
            })
        },
        {
            name: 'two queued items with one key get its executed result once, at the first of them',
            build: () => {
                const executedResult = buildEntry({ id: 'item-1', uuid: UUID_A, updated: true });
                return {
                    items: [
                        buildQueuedItem({ index: 0, uuid: UUID_B }),
                        buildQueuedItem({ index: 1, uuid: UUID_A }),
                        buildQueuedItem({ index: 2, uuid: UUID_A, id: UUID_A })
                    ],
                    executedResults: [executedResult],
                    expected: [buildEntry({ id: 'item-0', uuid: UUID_B }), executedResult]
                };
            }
        },
        {
            name: 'an unchanged and a queued item with one key get its executed result once, at the unchanged item',
            build: () => {
                const executedResult = buildEntry({ id: 'item-0', uuid: UUID_A, updated: true });
                return {
                    items: [
                        buildUnchangedItem({ index: 0, uuid: UUID_A }),
                        buildQueuedItem({ index: 1, uuid: UUID_A, id: UUID_A })
                    ],
                    executedResults: [executedResult],
                    expected: [executedResult]
                };
            }
        },
        {
            name: 'every executed result of a key is reported at the first item with that key',
            build: () => {
                const created = buildEntry({ id: 'item-0', uuid: UUID_A, created: true });
                const notModified = buildEntry({ id: UUID_A, uuid: UUID_A });
                return {
                    items: [
                        buildQueuedItem({ index: 0, uuid: UUID_A }),
                        buildQueuedItem({ index: 1, uuid: UUID_A, id: UUID_A })
                    ],
                    executedResults: [created, notModified],
                    expected: [created, notModified]
                };
            }
        },
        {
            name: 'two unchanged items with one key each get a not modified entry',
            build: () => ({
                items: [
                    buildUnchangedItem({ index: 0, uuid: UUID_A }),
                    buildUnchangedItem({ index: 1, uuid: UUID_A, id: UUID_A })
                ],
                executedResults: [],
                expected: [buildEntry({ id: 'item-0', uuid: UUID_A }), buildEntry({ id: UUID_A, uuid: UUID_A })]
            })
        },
        {
            name: 'an unchanged item whose key has a failure gets no entry of its own',
            build: () => {
                const failedItem = buildFailedItem({ index: 1, stage: WRITE_FAILURE_STAGE.RESULT_VALIDATION });
                return {
                    items: [buildUnchangedItem({ index: 0, uuid: failedItem.failure.subject.uuid }), failedItem],
                    executedResults: [],
                    expected: [responder.toResult(failedItem.failure)]
                };
            }
        },
        {
            name: 'an active item gets no entry',
            build: () => ({
                items: [
                    new WriteItem({
                        index: 0,
                        incoming: { resourceType: 'Patient', id: 'item-0', _uuid: UUID_A, _sourceAssigningAuthority: 'client' }
                    }),
                    buildUnchangedItem({ index: 1, uuid: UUID_B })
                ],
                executedResults: [],
                expected: [buildEntry({ id: 'item-1', uuid: UUID_B })]
            })
        },
        {
            name: 'request errors come first, then one entry per item in index order',
            build: () => {
                const failedItem = buildFailedItem({ index: 0, stage: WRITE_FAILURE_STAGE.STRUCTURE });
                const requestError = buildEntry({ id: 'request-error' });
                const executedResult = buildEntry({ id: 'item-2', uuid: UUID_A, created: true });
                return {
                    items: [
                        buildQueuedItem({ index: 2, uuid: UUID_A }),
                        failedItem,
                        buildUnchangedItem({ index: 1, uuid: UUID_B })
                    ],
                    requestErrors: [requestError],
                    executedResults: [executedResult],
                    expected: [
                        requestError,
                        responder.toResult(failedItem.failure),
                        buildEntry({ id: 'item-1', uuid: UUID_B }),
                        executedResult
                    ]
                };
            }
        },
        {
            name: 'an executed result that matches no item is appended after the item entries in its own order',
            build: () => {
                const matched = buildEntry({ id: 'item-0', uuid: UUID_A, updated: true });
                const otherUuid = buildEntry({ id: 'other', uuid: UUID_B, created: true });
                const otherResourceType = buildEntry({
                    id: 'item-0', uuid: UUID_A, resourceType: 'Observation', created: true
                });
                return {
                    items: [buildQueuedItem({ index: 0, uuid: UUID_A })],
                    executedResults: [otherUuid, otherResourceType, matched],
                    expected: [matched, otherUuid, otherResourceType]
                };
            }
        }
    ])('results: $name', ({ build }) => {
        const { items, requestErrors = [], executedResults, expected } = build();

        const results = responder.results({ items, requestErrors, executedResults });

        expect(results).toStrictEqual(expected);
    });

    test.each([
        {
            name: 'an outcome failure with an issue',
            operationOutcome: buildOperationOutcome('synthetic outcome'),
            expectedIssue: { severity: 'error', code: 'invalid', details: { text: 'synthetic outcome' } }
        },
        {
            name: 'an outcome failure without issues',
            operationOutcome: { resourceType: 'OperationOutcome', issue: [] },
            expectedIssue: null
        }
    ])('toResult maps $name', ({ operationOutcome, expectedIssue }) => {
        const subject = buildSubject(7);
        const failure = new WriteFailure({ stage: WRITE_FAILURE_STAGE.INCOMING_SCHEMA, subject, operationOutcome });

        const result = responder.toResult(failure);

        expect(result).toBeInstanceOf(MergeResultEntry);
        expect(result).toStrictEqual(new MergeResultEntry({
            id: subject.id,
            uuid: subject.uuid,
            sourceAssigningAuthority: subject.sourceAssigningAuthority,
            resourceType: subject.resourceType,
            created: false,
            updated: false,
            issue: expectedIssue,
            operationOutcome
        }));
        expect(result.operationOutcome).toBe(operationOutcome);
    });

    test('toResult maps an error failure like createFromError on the subject', () => {
        const subject = buildSubject(8);
        const error = new Error('synthetic write error');
        const failure = new WriteFailure({ stage: WRITE_FAILURE_STAGE.WRITE, subject, error });

        const result = responder.toResult(failure);

        expect(result).toStrictEqual(MergeResultEntry.createFromError({
            error,
            resource: {
                id: subject.id,
                _uuid: subject.uuid,
                _sourceAssigningAuthority: subject.sourceAssigningAuthority,
                resourceType: subject.resourceType
            }
        }));
        expect(result).toMatchObject({
            id: 'item-8',
            _uuid: subject.uuid,
            _sourceAssigningAuthority: 'client',
            resourceType: 'Patient',
            created: false,
            updated: false,
            issue: { severity: 'error', code: 'exception', diagnostics: 'synthetic write error' }
        });
    });
});
