const { applyOperation, JsonPatchError } = require('fast-json-patch');
const deepcopy = require('deepcopy');
const { resolveMemberWrite } = require('./resolveMemberWrite');
const { enrichMemberReferences } = require('../../utils/referenceEnricher');
const { PATCH_OPERATIONS } = require('../../constants/groupConstants');

/**
 * Paths that add one whole member to an embedded Group's member[]: append (`/member/-`), the
 * empty index (`/member/`, which fast-json-patch treats as index 0) and an explicit index.
 */
const SINGLE_MEMBER_PATH = /^\/member\/(\d*|-)$/;

/**
 * @param {Object} op
 * @returns {boolean}
 */
function isSingleMemberAdd(op) {
    return op?.op === PATCH_OPERATIONS.ADD &&
        typeof op.path === 'string' &&
        SINGLE_MEMBER_PATH.test(op.path) &&
        op.value !== null &&
        typeof op.value === 'object' &&
        !Array.isArray(op.value) &&
        typeof op.value.entity?.reference === 'string';
}

/**
 * The uuid an entity reference resolves to, computed from the reference alone the way
 * referenceGlobalIdHandler stamps entity._uuid on save. Any _uuid the client sent is ignored.
 *
 * @param {string} reference
 * @param {string} sourceAssigningAuthority - the Group's own sourceAssigningAuthority
 * @returns {string}
 */
function uuidForReference(reference, sourceAssigningAuthority) {
    const probe = [{ entity: { reference } }];
    enrichMemberReferences(probe, sourceAssigningAuthority);
    return probe[0].entity._uuid;
}

/**
 * The member an add writes: op.value with the reference fields the server stamps on save
 * (entity._uuid/_sourceId/_sourceAssigningAuthority) computed from the reference, so it has the
 * same shape as a stored member. Any of those fields the client sent are replaced.
 *
 * @param {Object} value - op.value of a single-member add
 * @param {string} sourceAssigningAuthority - the Group's own sourceAssigningAuthority
 * @returns {Object}
 */
function memberFromAdd(value, sourceAssigningAuthority) {
    const member = deepcopy(value);
    delete member.entity._uuid;
    delete member.entity._sourceId;
    delete member.entity._sourceAssigningAuthority;
    enrichMemberReferences([member], sourceAssigningAuthority);
    return member;
}

/**
 * Key of a member already in member[]: the stored entity._uuid, or, for a member added earlier in
 * the same PATCH, the uuid its reference resolves to.
 *
 * @param {Object} member
 * @param {string} sourceAssigningAuthority
 * @returns {string|null}
 */
function memberKey(member, sourceAssigningAuthority) {
    if (member?.entity?._uuid) {
        return member.entity._uuid;
    }
    return member?.entity?.reference
        ? uuidForReference(member.entity.reference, sourceAssigningAuthority)
        : null;
}

/**
 * Rewrites the add ops of an embedded Group PATCH so that adding a member who is already in
 * member[] (matched by the uuid of member.entity) never creates a second entry:
 * - an add equal to the stored member is dropped;
 * - any other add becomes a `replace` of that member at its current index with the value sent,
 *   so fields not sent are cleared (resolveMemberWrite, the same rules the extended Group path
 *   uses).
 * Adds of new members and every other op are kept as sent. The ops are simulated in order on a
 * copy of the Group, so a member added earlier in the same PATCH, or an index shifted by an
 * earlier op, is taken into account.
 *
 * If an op cannot be applied, the original ops are returned unchanged, so the caller's own
 * JSON Patch validation reports the same error the client would have got before.
 *
 * @param {Object} params
 * @param {Object[]} params.patchContent - JSON Patch ops
 * @param {Object} params.currentResource - the stored Group; not modified
 * @returns {Object[]} the ops to apply
 */
function rewriteMemberAddOperations({ patchContent, currentResource }) {
    const sourceAssigningAuthority = currentResource?._sourceAssigningAuthority;
    if (!sourceAssigningAuthority || !patchContent.some(isSingleMemberAdd)) {
        return patchContent;
    }

    const working = deepcopy(currentResource);
    /** @type {Map<string, Object>|null} member key -> member object in working.member */
    let membersByKey = null;
    const indexMembers = () => {
        membersByKey = new Map();
        for (const member of Array.isArray(working.member) ? working.member : []) {
            const key = memberKey(member, sourceAssigningAuthority);
            if (key && !membersByKey.has(key)) {
                membersByKey.set(key, member);
            }
        }
    };

    const rewritten = [];
    try {
        for (const op of patchContent) {
            if (!isSingleMemberAdd(op)) {
                rewritten.push(op);
                applyOperation(working, deepcopy(op), true, true);
                if (op.path?.startsWith('/member')) {
                    membersByKey = null;
                }
                continue;
            }

            if (!membersByKey) {
                indexMembers();
            }
            const added = memberFromAdd(op.value, sourceAssigningAuthority);
            const key = added.entity._uuid;
            const existing = membersByKey.get(key);

            if (!existing) {
                rewritten.push(op);
                applyOperation(working, { ...op, value: added }, true, true);
                membersByKey.set(key, added);
                continue;
            }

            const { writeType, member } = resolveMemberWrite(
                existing,
                { ...added, op: PATCH_OPERATIONS.ADD }
            );
            if (writeType === 'none') {
                continue;
            }
            const replaceOp = {
                op: 'replace',
                path: `/member/${working.member.indexOf(existing)}`,
                value: member
            };
            rewritten.push(replaceOp);
            const applied = deepcopy(replaceOp);
            applyOperation(working, applied, true, true);
            membersByKey.set(key, applied.value);
        }
    } catch (e) {
        if (e instanceof JsonPatchError) {
            return patchContent;
        }
        throw e;
    }
    return rewritten;
}

module.exports = {
    rewriteMemberAddOperations
};
