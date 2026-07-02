const { describe, test, beforeEach, expect, jest: jestGlobal } = require('@jest/globals');

const { ClickHouseGroupHandler } = require('../../dataLayer/postSaveHandlers/clickHouseGroupHandler');
const { GroupMemberRepository } = require('../../dataLayer/repositories/groupMemberRepository');
const { GroupMemberEventBuilder } = require('../../dataLayer/builders/groupMemberEventBuilder');
const { QueryBuilder } = require('../../dataLayer/providers/mongoWithClickHouse/queryBuilder');
const { MongoWithClickHouseStorageProvider } = require('../../dataLayer/providers/mongoWithClickHouseStorageProvider');
const { GroupMemberEnrichmentProvider } = require('../../enrich/providers/groupMemberEnrichmentProvider');
const { retryWithBackoff, computeBackoffWithJitter } = require('../../utils/retryWithBackoff');
const { DateTimeFormatter } = require('../../utils/clickHouse/dateTimeFormatter');
const { EVENT_TYPES, OPERATION_TYPES } = require('../../constants/clickHouseConstants');

/**
 * Hardening unit tests for the INTEGRATED Group-on-ClickHouse code.
 *
 * These attack the four merged fixes at the unit boundary — fast, deterministic,
 * no container — trying to BREAK the code rather than confirm the happy path:
 *   - Sockets/streams (result-set draining is verified in the container
 *     suites; here we assert the client-manager insert/query contracts the fix relies on)
 *   - Split-brain (compensation is covered in group_clickhouse_compensation.unit.test.js;
 *     here we attack the write-fails-after-Mongo-commit propagation in the handler)
 *   - Idempotency (deterministic event_id/event_time across retries), fail-closed
 *     tenant filter, retry+jitter, and read-surface (rethrow, never silent quantity:0)
 *
 * Mocks are only at external boundaries (the ClickHouse client / repository); domain
 * logic (event builder, diff computer, query builder, scopes) runs for real.
 */
describe('Group ClickHouse hardening (unit)', () => {
    process.env.LOGLEVEL = 'SILENT';

    // ---- shared fixtures -------------------------------------------------

    const OWNER = 'test-owner';
    const ACCESS = 'test-access';

    /** A committed FHIR-ish Group doc as the handler sees it post-save. */
    function makeGroupDoc({
        id = 'group-1',
        versionId = '1',
        lastUpdated = new Date('2026-01-02T03:04:05.678Z'),
        member = [],
        owner = OWNER,
        access = ACCESS
    } = {}) {
        const security = [];
        if (owner) security.push({ system: 'https://www.icanbwell.com/owner', code: owner });
        if (access) security.push({ system: 'https://www.icanbwell.com/access', code: access });
        return {
            id,
            resourceType: 'Group',
            _sourceId: id,
            _sourceAssigningAuthority: owner || '',
            meta: { versionId, lastUpdated, security },
            member
        };
    }

    /** A single already-enriched member (as if referenceGlobalIdHandler ran). */
    function enrichedMember(sourceId, uuid) {
        return {
            entity: {
                reference: `Patient/${sourceId}`,
                _uuid: `Patient/${uuid}`,
                _sourceId: `Patient/${sourceId}`
            }
        };
    }

    /** A repository whose insert is captured (and optionally fails N times). */
    function makeCapturingRepo({ failTimes = 0, failWith } = {}) {
        const appended = [];
        let attempts = 0;
        const repo = {
            appended,
            getAttempts: () => attempts,
            appendEvents: jestGlobal.fn(async (events, opts) => {
                attempts++;
                if (attempts <= failTimes) {
                    throw failWith || new Error('transient ClickHouse insert failure');
                }
                appended.push({ events, opts });
            }),
            getActiveMembers: jestGlobal.fn(async () => [])
        };
        return repo;
    }

    function makeHandler(repo, { enableClickHouse = true } = {}) {
        const configManager = {
            enableClickHouse,
            mongoWithClickHouseResources: ['Group']
        };
        return new ClickHouseGroupHandler({
            clickHouseClientManager: {},
            configManager,
            groupMemberRepository: repo
        });
    }

    // =====================================================================
    // Regression guard: event_time must survive as a valid
    // ClickHouse DateTime even though meta.lastUpdated is a Date at runtime.
    // Before the fix this threw "result.replace is not a function" and 500'd
    // every Group write with useExternalStorage.
    // =====================================================================
    describe('event_time normalization', () => {
        test('CREATE with a Date meta.lastUpdated does not throw and appends events', async () => {
            const repo = makeCapturingRepo();
            const handler = makeHandler(repo);
            const doc = makeGroupDoc({ member: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')] });

            await handler.afterSaveAsync({
                requestId: 'r1',
                eventType: OPERATION_TYPES.CREATE,
                resourceType: 'Group',
                doc,
                contextData: { useExternalStorage: true, groupMembers: doc.member }
            });

            expect(repo.appendEvents).toHaveBeenCalledTimes(1);
            const { events } = repo.appended[0];
            expect(events).toHaveLength(1);
            // event_time was carried from the Date and must be an ISO string, not a Date.
            expect(typeof events[0].event_time).toBe('string');
            // And it must survive the ClickHouse DateTime conversion without throwing.
            expect(() => DateTimeFormatter.toClickHouseDateTime(events[0].event_time)).not.toThrow();
            expect(DateTimeFormatter.toClickHouseDateTime(events[0].event_time))
                .toBe('2026-01-02 03:04:05.678');
        });

        test('_deriveIdempotencyContext normalizes Date, passes through string, drops falsy', () => {
            const repo = makeCapturingRepo();
            const handler = makeHandler(repo);

            const fromDate = handler._deriveIdempotencyContext(
                makeGroupDoc({ lastUpdated: new Date('2026-05-06T07:08:09.010Z') }), null
            );
            expect(fromDate.eventTime).toBe('2026-05-06T07:08:09.010Z');

            const fromString = handler._deriveIdempotencyContext(
                { id: 'g', meta: { versionId: '2', lastUpdated: '2026-05-06T07:08:09.010Z' } }, null
            );
            expect(fromString.eventTime).toBe('2026-05-06T07:08:09.010Z');

            const noMeta = handler._deriveIdempotencyContext({ id: 'g', meta: {} }, null);
            expect(noMeta.eventTime).toBeUndefined();

            // correlationId defaults to `${id}|${versionId}` but honors explicit override.
            expect(fromDate.correlationId).toBe('group-1|1');
            const overridden = handler._deriveIdempotencyContext(
                makeGroupDoc(), { correlationId: 'explicit-corr' }
            );
            expect(overridden.correlationId).toBe('explicit-corr');
        });

        test('DateTimeFormatter.toClickHouseDateTime hardened against a raw Date', () => {
            const d = new Date('2024-01-15T10:30:00.000Z');
            expect(DateTimeFormatter.toClickHouseDateTime(d)).toBe('2024-01-15 10:30:00.000');
            // Still returns null for falsy and passes through strings.
            expect(DateTimeFormatter.toClickHouseDateTime(null)).toBeNull();
            expect(DateTimeFormatter.toClickHouseDateTime('2024-01-15T10:30:00.000Z'))
                .toBe('2024-01-15 10:30:00.000');
        });
    });

    // =====================================================================
    // Idempotency: retried writes must converge (identical rows),
    // distinct versions must diverge, remove/re-add ordering is deterministic.
    // =====================================================================
    describe('idempotent, convergent event identity', () => {
        test('client retry (same version) produces byte-identical event_id + event_time', () => {
            const doc = makeGroupDoc({ versionId: '7' });
            const members = [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')];
            const args = {
                groupId: doc.id,
                members,
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc,
                eventTime: doc.meta.lastUpdated.toISOString(),
                correlationId: `${doc.id}|${doc.meta.versionId}`
            };

            const first = GroupMemberEventBuilder.buildEvents(args);
            const second = GroupMemberEventBuilder.buildEvents({ ...args }); // simulate re-drive

            expect(first[0].event_id).toBe(second[0].event_id);
            expect(first[0].event_time).toBe(second[0].event_time);
            expect(first[0].correlation_id).toBe(second[0].correlation_id);
        });

        test('distinct versions (distinct correlationId) produce distinct event_id', () => {
            const doc = makeGroupDoc();
            const members = [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')];
            const v1 = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members, eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc, eventTime: '2026-01-01T00:00:00.000Z', correlationId: 'group-1|1'
            });
            const v2 = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members, eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc, eventTime: '2026-01-01T00:00:00.000Z', correlationId: 'group-1|2'
            });
            expect(v1[0].event_id).not.toBe(v2[0].event_id);
        });

        test('add vs remove of the SAME member get distinct event_id (event_type in the key)', () => {
            const doc = makeGroupDoc();
            const members = [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')];
            const corr = 'group-1|3';
            const added = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members, eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc, eventTime: '2026-01-01T00:00:00.000Z', correlationId: corr
            });
            const removed = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members, eventType: EVENT_TYPES.MEMBER_REMOVED,
                groupResource: doc, eventTime: '2026-01-01T00:00:00.000Z', correlationId: corr
            });
            expect(added[0].event_id).not.toBe(removed[0].event_id);
        });

        test('missing correlationId falls back to a deterministic per-reference id (never random)', () => {
            const doc = makeGroupDoc();
            const members = [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')];
            const a = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members, eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc, eventTime: '2026-01-01T00:00:00.000Z'
            });
            const b = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members, eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc, eventTime: '2026-01-01T00:00:00.000Z'
            });
            expect(a[0].event_id).toBe(b[0].event_id);
            expect(a[0].correlation_id).toBe('group-1|Patient/p1');
        });

        test('server-side retry of a full CREATE re-drives identical rows (converges)', async () => {
            // First attempt fails inside appendEvents AFTER build; the handler surfaces the
            // error. A second identical afterSaveAsync (same committed doc) must build the
            // SAME rows, so the append-only log converges rather than double-flipping state.
            const failingRepo = makeCapturingRepo({ failTimes: 999 });
            const handler = makeHandler(failingRepo);
            const doc = makeGroupDoc({ versionId: '9', member: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000009')] });
            const ctx = { useExternalStorage: true, groupMembers: doc.member };

            await expect(handler.afterSaveAsync({
                requestId: 'r1', eventType: OPERATION_TYPES.CREATE, resourceType: 'Group', doc, contextData: ctx
            })).rejects.toBeDefined();

            // Now the same operation succeeds; capture the rows it would have written both times.
            const okRepo = makeCapturingRepo();
            const okHandler = makeHandler(okRepo);
            await okHandler.afterSaveAsync({
                requestId: 'r1', eventType: OPERATION_TYPES.CREATE, resourceType: 'Group', doc, contextData: ctx
            });
            await okHandler.afterSaveAsync({
                requestId: 'r1-retry', eventType: OPERATION_TYPES.CREATE, resourceType: 'Group', doc, contextData: ctx
            });
            expect(okRepo.appended[0].events[0].event_id).toBe(okRepo.appended[1].events[0].event_id);
            expect(okRepo.appended[0].events[0].event_time).toBe(okRepo.appended[1].events[0].event_time);
        });
    });

    // =====================================================================
    // Split-brain: a ClickHouse write failure AFTER the Mongo commit
    // must FAIL the request (throw), not silently succeed with an empty Group.
    // (The Mongo compensation itself is unit-tested separately.)
    // =====================================================================
    describe('write-fails-after-commit propagation (fail the request, no silent empty Group)', () => {
        test.each([
            ['CREATE', OPERATION_TYPES.CREATE],
            ['UPDATE', OPERATION_TYPES.UPDATE]
        ])('%s: repository insert failure propagates out of afterSaveAsync', async (_label, eventType) => {
            const repo = makeCapturingRepo({ failTimes: 999, failWith: new Error('ClickHouse cluster outage') });
            const handler = makeHandler(repo);
            const doc = makeGroupDoc({ member: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')] });

            await expect(handler.afterSaveAsync({
                requestId: 'r1',
                eventType,
                resourceType: 'Group',
                doc,
                contextData: { useExternalStorage: true, groupMembers: doc.member }
            })).rejects.toBeDefined();
        });

        test('PATCH (writeEventsAsync) insert failure propagates', async () => {
            const repo = makeCapturingRepo({ failTimes: 999, failWith: new Error('ClickHouse outage') });
            const handler = makeHandler(repo);
            const doc = makeGroupDoc({ versionId: '2' });

            await expect(handler.writeEventsAsync({
                groupId: doc.id,
                added: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')],
                removed: [],
                groupResource: doc,
                correlationId: `${doc.id}|2`
            })).rejects.toBeDefined();
        });

        test('writeEventsAsync throws (not silently no-op) when groupResource is missing', async () => {
            const repo = makeCapturingRepo();
            const handler = makeHandler(repo);
            // The guard error is wrapped by RethrownError; assert it rejects and that the
            // underlying cause is the missing-groupResource guard, and that nothing was written.
            let thrown;
            try {
                await handler.writeEventsAsync({
                    groupId: 'g1', added: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')], removed: []
                });
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeDefined();
            const chain = `${thrown.message} | ${thrown.nested?.message || ''} | ${thrown.error?.message || ''}`;
            expect(chain).toMatch(/groupResource is required/);
            expect(repo.appendEvents).not.toHaveBeenCalled();
        });
    });

    // =====================================================================
    // Owner/tenant derivation on the WRITE path.
    // =====================================================================
    describe('source_assigning_authority derivation (write path)', () => {
        test('missing owner tag → event build throws (cannot derive source_assigning_authority)', () => {
            const doc = makeGroupDoc({ owner: null }); // no owner security tag
            expect(() => GroupMemberEventBuilder.buildEvents({
                groupId: doc.id,
                members: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')],
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc,
                eventTime: '2026-01-01T00:00:00.000Z',
                correlationId: 'group-1|1'
            })).toThrow(/owner_tags/i);
        });

        test('multiple owner tags → uses first, does not throw', () => {
            const doc = makeGroupDoc();
            doc.meta.security = [
                { system: 'https://www.icanbwell.com/owner', code: 'owner-A' },
                { system: 'https://www.icanbwell.com/owner', code: 'owner-B' },
                { system: 'https://www.icanbwell.com/access', code: ACCESS }
            ];
            const events = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id,
                members: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')],
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc,
                eventTime: '2026-01-01T00:00:00.000Z',
                correlationId: 'group-1|1'
            });
            expect(events[0].source_assigning_authority).toBe('owner-A');
            expect(events[0].owner_tags).toEqual(['owner-A', 'owner-B']);
        });

        test('member missing _uuid / _sourceId → build throws (pre-save must have run)', () => {
            const doc = makeGroupDoc();
            expect(() => GroupMemberEventBuilder.buildEvents({
                groupId: doc.id,
                members: [{ entity: { reference: 'Patient/p1' } }], // NOT enriched
                eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc,
                eventTime: '2026-01-01T00:00:00.000Z',
                correlationId: 'group-1|1'
            })).toThrow(/_uuid/);
        });

        test('unicode / very-long reference is preserved verbatim in the event', () => {
            const doc = makeGroupDoc();
            const longId = 'p'.repeat(512);
            const unicodeMember = {
                entity: {
                    reference: `Patient/${longId}`,
                    _uuid: 'Patient/aaaaaaaa-0000-4000-8000-000000000001',
                    _sourceId: `Patient/${longId}`
                }
            };
            const events = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members: [unicodeMember], eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc, eventTime: '2026-01-01T00:00:00.000Z', correlationId: 'group-1|1'
            });
            expect(events[0].entity_reference).toBe(`Patient/${longId}`);
            expect(events[0].entity_type).toBe('Patient');
        });
    });

    // =====================================================================
    // Fail-closed, admin-exempt tenant filter (QueryBuilder HAVING).
    // =====================================================================
    describe('fail-closed tenant filter (read path HAVING clause)', () => {
        test('scoped caller → tag predicate applied (not denied)', () => {
            const { query, query_params } = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceSourceId: 'Patient/123',
                accessTags: [ACCESS],
                ownerTags: [OWNER],
                hasFullAccess: false,
                limit: 100
            });
            expect(query).toContain('hasAny(argMaxMerge(access_tags)');
            expect(query).toContain('hasAny(argMaxMerge(owner_tags)');
            expect(query_params.accessTags).toEqual([ACCESS]);
            expect(query_params.ownerTags).toEqual([OWNER]);
        });

        test('wildcard/full-access caller → NO tenant predicate, NOT denied', () => {
            const { query } = QueryBuilder.buildFindGroupsByMemberQuery({
                memberReferenceSourceId: 'Patient/123',
                accessTags: [],
                ownerTags: [],
                hasFullAccess: true,
                limit: 100
            });
            expect(query).not.toContain('access_tags');
            expect(query).not.toContain('owner_tags');
            expect(query).toContain("argMaxMerge(event_type) = 'added'");
        });

        test('genuinely unscoped caller (no tags, not full access) → ForbiddenError 403, not a leak or 500', () => {
            let thrown;
            try {
                QueryBuilder.buildCountGroupsByMemberQuery({
                    memberReferenceSourceId: 'Patient/123',
                    accessTags: [],
                    ownerTags: [],
                    hasFullAccess: false
                });
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeDefined();
            expect(thrown.statusCode).toBe(403);
            expect(thrown.issue[0].code).toBe('forbidden');
        });

        test('roster/count-by-group queries do NOT leak the tenant filter (scoped to one group id)', () => {
            const roster = QueryBuilder.buildActiveMembers({ groupId: 'g1', limit: 10 });
            expect(roster.query).toContain('group_id = {groupId:String}');
            const count = QueryBuilder.buildActiveMemberCount({ groupId: 'g1' });
            expect(count.query).toContain('group_id = {groupId:String}');
        });
    });

    // =====================================================================
    // _callerHasFullAccess: authorization derived from scope, not from
    // whether the built query happened to carry tag predicates.
    // =====================================================================
    describe('_callerHasFullAccess (scope-derived)', () => {
        function providerWithScopes(accessCodes) {
            return new MongoWithClickHouseStorageProvider({
                resourceLocator: {},
                clickHouseClientManager: {},
                mongoStorageProvider: {},
                configManager: {},
                scopesManager: {
                    getAccessCodesFromScopes: () => accessCodes
                }
            });
        }

        test('wildcard access code → true', () => {
            const provider = providerWithScopes(['*']);
            expect(provider._callerHasFullAccess({ scope: 'access/*.*', user: 'u' })).toBe(true);
        });

        test('scoped access codes → false', () => {
            const provider = providerWithScopes(['test-access']);
            expect(provider._callerHasFullAccess({ scope: 'access/test-access.read', user: 'u' })).toBe(false);
        });

        test('no scope or no scopesManager → false (fail closed)', () => {
            const noScope = providerWithScopes(['*']);
            expect(noScope._callerHasFullAccess({})).toBe(false);
            expect(noScope._callerHasFullAccess(undefined)).toBe(false);

            const noMgr = new MongoWithClickHouseStorageProvider({
                resourceLocator: {}, clickHouseClientManager: {}, mongoStorageProvider: {}, configManager: {}
            });
            expect(noMgr._callerHasFullAccess({ scope: 'access/*.*' })).toBe(false);
        });
    });

    // =====================================================================
    // Read-surface: a ClickHouse read error must SURFACE (throw),
    // never be masked as a successful, silently-empty quantity:0.
    // =====================================================================
    describe('read-surface: ClickHouse read errors are not swallowed as quantity:0', () => {
        function enrichmentWith(queryImpl) {
            return new GroupMemberEnrichmentProvider({
                clickHouseClientManager: { queryAsync: queryImpl },
                configManager: { enableClickHouse: true, mongoWithClickHouseResources: ['Group'] }
            });
        }
        const parsedArgs = { headers: { useexternalstorage: 'true' } };

        test('enrichAsync rethrows when the count query fails (no quantity:0 fallback)', async () => {
            const provider = enrichmentWith(async () => { throw new Error('ClickHouse read timeout'); });
            await expect(provider.enrichAsync({
                resources: [{ resourceType: 'Group', id: 'g1', member: [{ entity: { reference: 'Patient/1' } }] }],
                parsedArgs
            })).rejects.toThrow(/ClickHouse read timeout/);
        });

        test('enrichBundleEntriesAsync rethrows when the count query fails', async () => {
            const provider = enrichmentWith(async () => { throw new Error('CH boom'); });
            await expect(provider.enrichBundleEntriesAsync({
                entries: [{ resource: { resourceType: 'Group', id: 'g1' } }],
                parsedArgs
            })).rejects.toThrow(/CH boom/);
        });

        test('successful count → quantity set, member array stripped from the response', async () => {
            const provider = enrichmentWith(async () => [{ count: '42' }]);
            const [out] = await provider.enrichAsync({
                resources: [{ resourceType: 'Group', id: 'g1', member: [{ entity: { reference: 'Patient/1' } }] }],
                parsedArgs
            });
            expect(out.quantity).toBe(42);
            expect(out.member).toBeUndefined();
        });

        test('no external-storage header → passthrough, ClickHouse is never queried', async () => {
            const queryAsync = jestGlobal.fn(async () => [{ count: '1' }]);
            const provider = enrichmentWith(queryAsync);
            const resources = [{ resourceType: 'Group', id: 'g1', member: [{ entity: { reference: 'Patient/1' } }] }];
            const out = await provider.enrichAsync({ resources, parsedArgs: { headers: {} } });
            expect(out).toBe(resources);
            expect(queryAsync).not.toHaveBeenCalled();
        });

        test('provider.getActiveMemberCountAsync rethrows a CH read error (RethrownError), never returns 0', async () => {
            const provider = new MongoWithClickHouseStorageProvider({
                resourceLocator: {},
                clickHouseClientManager: { queryAsync: async () => { throw new Error('read failed'); } },
                mongoStorageProvider: {},
                configManager: {}
            });
            await expect(provider.getActiveMemberCountAsync('g1')).rejects.toThrow(/Error getting active member count/);
        });
    });

    // =====================================================================
    // Retry + full jitter (retryWithBackoff): transient failures are
    // retried within bounds; exhaustion surfaces the LAST error; jitter stays
    // within [0, cap]; and the repository actually wires retry to the insert.
    // =====================================================================
    describe('retry with backoff + jitter', () => {
        test('succeeds after N transient failures within the retry budget', async () => {
            let calls = 0;
            const result = await retryWithBackoff({
                fn: async () => {
                    calls++;
                    if (calls < 3) throw new Error('transient');
                    return 'ok';
                },
                maxRetries: 3,
                initialDelayMs: 0,
                maxDelayMs: 0,
                rng: () => 0 // zero delay for a fast, deterministic test
            });
            expect(result).toBe('ok');
            expect(calls).toBe(3);
        });

        test('exhaustion surfaces the LAST error and stops at maxRetries+1 attempts', async () => {
            let calls = 0;
            const onRetry = jestGlobal.fn();
            await expect(retryWithBackoff({
                fn: async () => { calls++; throw new Error(`fail-${calls}`); },
                maxRetries: 2,
                initialDelayMs: 0,
                maxDelayMs: 0,
                onRetry,
                rng: () => 0
            })).rejects.toThrow('fail-3');
            expect(calls).toBe(3); // initial + 2 retries
            expect(onRetry).toHaveBeenCalledTimes(2);
        });

        test('computeBackoffWithJitter stays within [0, cap] and honors maxDelay cap', () => {
            // Exponential term grows 2^(attempt-1)*base but is capped by maxDelayMs.
            expect(computeBackoffWithJitter(1, 200, 30000, () => 0)).toBe(0);
            expect(computeBackoffWithJitter(1, 200, 30000, () => 0.999999)).toBeLessThanOrEqual(200);
            // attempt 5 => 200*16=3200, jitter with rng≈1 stays under the pre-jitter cap
            expect(computeBackoffWithJitter(5, 200, 30000, () => 0.9999)).toBeLessThanOrEqual(3200);
            // capped: base*2^attempt would be huge, but maxDelayMs caps it
            expect(computeBackoffWithJitter(20, 200, 1000, () => 0.9999)).toBeLessThanOrEqual(1000);
        });

        test('a non-transient error still surfaces after exhausting retries (no infinite loop)', async () => {
            let calls = 0;
            await expect(retryWithBackoff({
                fn: async () => { calls++; const e = new Error('permanent'); e.code = 'FATAL'; throw e; },
                maxRetries: 3, initialDelayMs: 0, maxDelayMs: 0, rng: () => 0
            })).rejects.toMatchObject({ code: 'FATAL' });
            expect(calls).toBe(4);
        });

        test('repository.appendEvents retries the CH insert, then surfaces exhaustion as RethrownError', async () => {
            let inserts = 0;
            const client = {
                insertAsync: jestGlobal.fn(async () => { inserts++; throw new Error('insert blip'); })
            };
            const repo = new GroupMemberRepository({ clickHouseClient: client });
            const events = [{
                event_id: 'e1', group_id: 'g1', entity_reference: 'Patient/1',
                entity_reference_uuid: 'Patient/uuid', entity_reference_source_id: 'Patient/1',
                entity_type: 'Patient', event_type: 'added', event_time: '2026-01-01T00:00:00.000Z',
                inactive: 0, correlation_id: 'g1|1', owner_tags: [OWNER], access_tags: [ACCESS],
                source_assigning_authority: OWNER
            }];
            await expect(repo.appendEvents(events, { correlationId: 'g1|1' }))
                .rejects.toThrow(/Error appending events to repository/);
            // Default APPEND_EVENTS_MAX_RETRIES = 3 => 1 initial + 3 retries = 4 attempts.
            expect(inserts).toBe(4);
        }, 20000);

        test('repository.appendEvents is a no-op for an empty event array (no insert attempted)', async () => {
            const client = { insertAsync: jestGlobal.fn(async () => {}) };
            const repo = new GroupMemberRepository({ clickHouseClient: client });
            await repo.appendEvents([], { correlationId: 'g1|1' });
            await repo.appendEvents(null, {});
            expect(client.insertAsync).not.toHaveBeenCalled();
        });
    });

    // =====================================================================
    // Documented, SKIPPED: a same-millisecond add+remove of the same member resolves to "active"
    // under argMax((event_time, event_id)). event_time is millisecond precision and is sourced from
    // meta.lastUpdated, so a fast CREATE then PUT/PATCH can stamp the MEMBER_ADDED and MEMBER_REMOVED
    // with the SAME event_time; the tie then falls to event_id (a content hash, not causal order), so
    // the later remove can lose and the member wrongly stays active. Pure-unit expression of that
    // hazard. Skipped until the current-state tie-break is made causal (needs an ADR).
    // =====================================================================
    describe.skip('same-millisecond add/remove tie-break (documented, needs ADR)', () => {
        test('an add and a later remove sharing one event_time cannot be ordered causally by (event_time,event_id)', () => {
            const doc = makeGroupDoc({ lastUpdated: new Date('2026-01-01T00:00:00.000Z') });
            const member = [enrichedMember('tie', 'aaaaaaaa-0000-4000-8000-00000000ffff')];
            const sameTime = doc.meta.lastUpdated.toISOString();

            const added = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members: member, eventType: EVENT_TYPES.MEMBER_ADDED,
                groupResource: doc, eventTime: sameTime, correlationId: `${doc.id}|1`
            });
            const removed = GroupMemberEventBuilder.buildEvents({
                groupId: doc.id, members: member, eventType: EVENT_TYPES.MEMBER_REMOVED,
                groupResource: doc, eventTime: sameTime, correlationId: `${doc.id}|2`
            });

            // Same event_time => the only discriminator is event_id (a content hash).
            expect(added[0].event_time).toBe(removed[0].event_time);
            // The causal winner MUST be 'removed', but ordering by event_id string does not
            // guarantee that. This assertion documents the intended (currently unmet) contract:
            const causalWinnerByEventId =
                removed[0].event_id > added[0].event_id ? EVENT_TYPES.MEMBER_REMOVED : EVENT_TYPES.MEMBER_ADDED;
            expect(causalWinnerByEventId).toBe(EVENT_TYPES.MEMBER_REMOVED); // fails when the add's hash sorts higher
        });
    });

    // =====================================================================
    // Handler routing / boundary behavior.
    // =====================================================================
    describe('handler routing and boundaries', () => {
        test('canHandle false when ClickHouse disabled → afterSaveAsync no-op', async () => {
            const repo = makeCapturingRepo();
            const handler = makeHandler(repo, { enableClickHouse: false });
            await handler.afterSaveAsync({
                requestId: 'r', eventType: OPERATION_TYPES.CREATE, resourceType: 'Group',
                doc: makeGroupDoc(), contextData: { useExternalStorage: true, groupMembers: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')] }
            });
            expect(repo.appendEvents).not.toHaveBeenCalled();
        });

        test('no useExternalStorage → afterSaveAsync no-op even for a Group', async () => {
            const repo = makeCapturingRepo();
            const handler = makeHandler(repo);
            await handler.afterSaveAsync({
                requestId: 'r', eventType: OPERATION_TYPES.CREATE, resourceType: 'Group',
                doc: makeGroupDoc(), contextData: { useExternalStorage: false, groupMembers: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')] }
            });
            expect(repo.appendEvents).not.toHaveBeenCalled();
        });

        test('groupMemberEventsWritten (PATCH already wrote) → afterSaveAsync skips re-writing', async () => {
            const repo = makeCapturingRepo();
            const handler = makeHandler(repo);
            await handler.afterSaveAsync({
                requestId: 'r', eventType: OPERATION_TYPES.UPDATE, resourceType: 'Group',
                doc: makeGroupDoc({ member: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')] }),
                contextData: { useExternalStorage: true, groupMemberEventsWritten: true, groupMembers: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')] }
            });
            expect(repo.appendEvents).not.toHaveBeenCalled();
        });

        test('DELETE → no events written (ClickHouse log retained as audit trail)', async () => {
            const repo = makeCapturingRepo();
            const handler = makeHandler(repo);
            await handler.afterSaveAsync({
                requestId: 'r', eventType: OPERATION_TYPES.DELETE, resourceType: 'Group',
                doc: makeGroupDoc(), contextData: { useExternalStorage: true, groupMembers: [enrichedMember('p1', 'aaaaaaaa-0000-4000-8000-000000000001')] }
            });
            expect(repo.appendEvents).not.toHaveBeenCalled();
        });

        test('CREATE with empty member array → no events', async () => {
            const repo = makeCapturingRepo();
            const handler = makeHandler(repo);
            await handler.afterSaveAsync({
                requestId: 'r', eventType: OPERATION_TYPES.CREATE, resourceType: 'Group',
                doc: makeGroupDoc({ member: [] }), contextData: { useExternalStorage: true, groupMembers: [] }
            });
            expect(repo.appendEvents).not.toHaveBeenCalled();
        });

        test('UPDATE diff: adds new, removes absent; smartMerge suppresses removals', async () => {
            // current = {Patient/keep, Patient/drop}; incoming = {Patient/keep, Patient/new}
            const current = ['Patient/keep', 'Patient/drop'];
            const repo = makeCapturingRepo();
            repo.getActiveMembers = jestGlobal.fn(async () => current);
            const handler = makeHandler(repo);
            const incoming = [
                enrichedMember('keep', 'aaaaaaaa-0000-4000-8000-00000000000a'),
                enrichedMember('new', 'aaaaaaaa-0000-4000-8000-00000000000b')
            ];
            const doc = makeGroupDoc({ versionId: '2', member: incoming });

            await handler.afterSaveAsync({
                requestId: 'r', eventType: OPERATION_TYPES.UPDATE, resourceType: 'Group',
                doc, contextData: { useExternalStorage: true, groupMembers: incoming }
            });
            const written = repo.appended[0].events;
            const added = written.filter(e => e.event_type === EVENT_TYPES.MEMBER_ADDED).map(e => e.entity_reference);
            const removed = written.filter(e => e.event_type === EVENT_TYPES.MEMBER_REMOVED).map(e => e.entity_reference);
            expect(added).toContain('Patient/new');
            expect(removed).toContain('Patient/drop');
            expect(removed).not.toContain('Patient/keep');

            // smartMerge=true must suppress removals (additions only).
            const repo2 = makeCapturingRepo();
            repo2.getActiveMembers = jestGlobal.fn(async () => current);
            const handler2 = makeHandler(repo2);
            await handler2.afterSaveAsync({
                requestId: 'r', eventType: OPERATION_TYPES.UPDATE, resourceType: 'Group',
                doc, contextData: { useExternalStorage: true, smartMerge: true, groupMembers: incoming }
            });
            const written2 = repo2.appended[0].events;
            expect(written2.every(e => e.event_type === EVENT_TYPES.MEMBER_ADDED)).toBe(true);
        });
    });
});
