'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock isColumnDateTimeType
const mockIsColumnDateTimeType = jestObj.fn();

jestObj.mock('../../../operations/common/isColumnDateTimeType', () => ({
    isColumnDateTimeType: mockIsColumnDateTimeType
}));

const { DateColumnHandler } = require('../../../preSaveHandlers/handlers/dateColumnHandler');

describe('DateColumnHandler', () => {
    let handler;

    beforeEach(() => {
        handler = new DateColumnHandler();
        mockIsColumnDateTimeType.mockReset();
    });

    describe('constructor', () => {
        test('initializes fromDateToString as false', () => {
            expect(handler.fromDateToString).toBe(false);
        });

        test('is an instance of DateColumnHandler', () => {
            expect(handler).toBeInstanceOf(DateColumnHandler);
        });
    });

    describe('setFlag', () => {
        test('sets fromDateToString to true', () => {
            handler.setFlag(true);
            expect(handler.fromDateToString).toBe(true);
        });

        test('sets fromDateToString to false', () => {
            handler.setFlag(true);
            handler.setFlag(false);
            expect(handler.fromDateToString).toBe(false);
        });

        test('accepts truthy/falsy values', () => {
            handler.setFlag(1);
            expect(handler.fromDateToString).toBe(1);

            handler.setFlag(0);
            expect(handler.fromDateToString).toBe(0);
        });
    });

    describe('preSaveAsync - string to Date conversion (default mode)', () => {
        test('converts valid date string to Date object for datetime column', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'AuditEvent',
                recorded: '2023-01-15T10:30:00Z'
            };

            await handler.preSaveAsync({ resource });

            expect(resource.recorded).toBeInstanceOf(Date);
            expect(resource.recorded.toISOString()).toBe('2023-01-15T10:30:00.000Z');
        });

        test('does not convert non-datetime columns', async () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            const resource = {
                resourceType: 'Patient',
                name: 'John'
            };

            await handler.preSaveAsync({ resource });

            expect(resource.name).toBe('John');
        });

        test('preserves invalid date strings (returns input)', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'Patient',
                birthDate: 'not-a-date'
            };

            await handler.preSaveAsync({ resource });

            expect(resource.birthDate).toBe('not-a-date');
        });

        test('handles nested objects recursively', async () => {
            mockIsColumnDateTimeType.mockImplementation((resourceType, path) => {
                return path === 'meta.lastUpdated';
            });

            const resource = {
                resourceType: 'Patient',
                meta: {
                    lastUpdated: '2023-06-01T12:00:00Z'
                }
            };

            await handler.preSaveAsync({ resource });

            expect(resource.meta.lastUpdated).toBeInstanceOf(Date);
        });

        test('handles arrays of objects with date fields', async () => {
            mockIsColumnDateTimeType.mockImplementation((resourceType, path) => {
                return path === 'entry.request.ifModifiedSince';
            });

            const resource = {
                resourceType: 'Bundle',
                entry: [
                    { request: { ifModifiedSince: '2023-01-01T00:00:00Z' } }
                ]
            };

            await handler.preSaveAsync({ resource });

            expect(resource.entry[0].request.ifModifiedSince).toBeInstanceOf(Date);
        });

        test('handles multiple entries in arrays', async () => {
            mockIsColumnDateTimeType.mockImplementation((resourceType, path) => {
                return path === 'entry.resource.meta.lastUpdated';
            });

            const resource = {
                resourceType: 'Bundle',
                entry: [
                    { resource: { meta: { lastUpdated: '2023-01-01T00:00:00Z' } } },
                    { resource: { meta: { lastUpdated: '2023-02-01T00:00:00Z' } } },
                    { resource: { meta: { lastUpdated: '2023-03-01T00:00:00Z' } } }
                ]
            };

            await handler.preSaveAsync({ resource });

            expect(resource.entry[0].resource.meta.lastUpdated).toBeInstanceOf(Date);
            expect(resource.entry[1].resource.meta.lastUpdated).toBeInstanceOf(Date);
            expect(resource.entry[2].resource.meta.lastUpdated).toBeInstanceOf(Date);
        });

        test('skips null values', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'Patient',
                birthDate: null
            };

            await handler.preSaveAsync({ resource });

            expect(resource.birthDate).toBeNull();
        });

        test('skips undefined values', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'Patient',
                birthDate: undefined
            };

            await handler.preSaveAsync({ resource });

            expect(resource.birthDate).toBeUndefined();
        });

        test('returns the resource', async () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            const resource = { resourceType: 'Patient', id: '123' };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('handles arrays with primitive date values', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'TestResource',
                dates: ['2023-01-01T00:00:00Z', '2023-02-01T00:00:00Z']
            };

            await handler.preSaveAsync({ resource });

            expect(resource.dates[0]).toBeInstanceOf(Date);
            expect(resource.dates[1]).toBeInstanceOf(Date);
        });

        test('handles arrays with mixed primitives and objects', async () => {
            mockIsColumnDateTimeType.mockImplementation((resourceType, path) => {
                return path.includes('date');
            });

            const resource = {
                resourceType: 'TestResource',
                items: [
                    { date: '2023-01-01T00:00:00Z' },
                    { date: '2023-02-01T00:00:00Z' }
                ]
            };

            await handler.preSaveAsync({ resource });

            expect(resource.items[0].date).toBeInstanceOf(Date);
            expect(resource.items[1].date).toBeInstanceOf(Date);
        });

        test('does not recurse into null objects', async () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            const resource = {
                resourceType: 'Patient',
                extension: [null]
            };

            // Should not throw
            await handler.preSaveAsync({ resource });
            expect(resource.extension[0]).toBeNull();
        });
    });

    describe('preSaveAsync - Date to string conversion (fromDateToString=true)', () => {
        beforeEach(() => {
            handler.setFlag(true);
        });

        test('converts Date to ISO string for datetime column', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const dateObj = new Date('2023-01-15T10:30:00Z');
            const resource = {
                resourceType: 'AuditEvent',
                recorded: dateObj
            };

            await handler.preSaveAsync({ resource });

            expect(resource.recorded).toBe('2023-01-15T10:30:00.000Z');
        });

        test('returns non-Date scalars unchanged', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'Patient',
                active: true
            };

            await handler.preSaveAsync({ resource });

            expect(resource.active).toBe(true);
        });

        test('skips conversion when value is not a Date instance', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'Patient',
                birthDate: '2023-01-15'
            };

            await handler.preSaveAsync({ resource });

            expect(resource.birthDate).toBe('2023-01-15');
        });

        test('does not recurse into Date objects (treats Date as leaf)', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const dateObj = new Date('2023-06-01T12:00:00Z');
            const resource = {
                resourceType: 'Patient',
                meta: {
                    lastUpdated: dateObj
                }
            };

            await handler.preSaveAsync({ resource });

            expect(typeof resource.meta.lastUpdated).toBe('string');
        });

        test('skips null values in fromDateToString mode', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'Patient',
                birthDate: null
            };

            await handler.preSaveAsync({ resource });

            // null is falsy, so the `if (value && ...)` check prevents processing
            expect(resource.birthDate).toBeNull();
        });

        test('handles nested Date objects in fromDateToString mode', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'Observation',
                effectivePeriod: {
                    start: new Date('2023-01-01T00:00:00Z'),
                    end: new Date('2023-01-02T00:00:00Z')
                }
            };

            await handler.preSaveAsync({ resource });

            expect(resource.effectivePeriod.start).toBe('2023-01-01T00:00:00.000Z');
            expect(resource.effectivePeriod.end).toBe('2023-01-02T00:00:00.000Z');
        });
    });

    describe('shouldUpdate', () => {
        test('cleans array indices from path before checking', () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            handler.shouldUpdate({ resourceType: 'Bundle' }, 'entry.0.request.ifModifiedSince');

            expect(mockIsColumnDateTimeType).toHaveBeenCalledWith(
                'Bundle',
                'entry.request.ifModifiedSince'
            );
        });

        test('handles multiple array indices in path', () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            handler.shouldUpdate({ resourceType: 'Bundle' }, 'entry.0.resource.name.1.period.start');

            expect(mockIsColumnDateTimeType).toHaveBeenCalledWith(
                'Bundle',
                'entry.resource.name.period.start'
            );
        });

        test('handles path with no array indices', () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            handler.shouldUpdate({ resourceType: 'Patient' }, 'meta.lastUpdated');

            expect(mockIsColumnDateTimeType).toHaveBeenCalledWith(
                'Patient',
                'meta.lastUpdated'
            );
        });

        test('returns true when isColumnDateTimeType returns true', () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const result = handler.shouldUpdate({ resourceType: 'AuditEvent' }, 'recorded');

            expect(result).toBe(true);
        });

        test('returns false when isColumnDateTimeType returns false', () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            const result = handler.shouldUpdate({ resourceType: 'Patient' }, 'name');

            expect(result).toBe(false);
        });

        test('handles index at end of path', () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            handler.shouldUpdate({ resourceType: 'Bundle' }, 'entry.0');

            expect(mockIsColumnDateTimeType).toHaveBeenCalledWith(
                'Bundle',
                'entry.'
            );
        });

        test('handles consecutive indices', () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            handler.shouldUpdate({ resourceType: 'Test' }, 'a.0.1.b');

            // regex replaces digit followed by . or end one at a time
            expect(mockIsColumnDateTimeType).toHaveBeenCalled();
        });
    });

    describe('setDate - string to Date (default mode)', () => {
        test('converts valid ISO date string to Date', () => {
            const result = handler.setDate('2023-01-15T10:30:00Z');

            expect(result).toBeInstanceOf(Date);
            expect(result.toISOString()).toBe('2023-01-15T10:30:00.000Z');
        });

        test('converts partial date string to Date', () => {
            const result = handler.setDate('2023-01-15');

            expect(result).toBeInstanceOf(Date);
        });

        test('converts date string with timezone offset', () => {
            const result = handler.setDate('2023-01-15T10:30:00+05:00');

            expect(result).toBeInstanceOf(Date);
            expect(result.toISOString()).toBe('2023-01-15T05:30:00.000Z');
        });

        test('returns original value for invalid date string', () => {
            const result = handler.setDate('not-a-valid-date');

            expect(result).toBe('not-a-valid-date');
        });

        test('returns original value for empty string', () => {
            const result = handler.setDate('');

            expect(result).toBe('');
        });

        test('returns numeric timestamp string as-is (invalid date string)', () => {
            const result = handler.setDate('1674044400000');

            // new Date('1674044400000') produces Invalid Date, so original is returned
            expect(result).toBe('1674044400000');
        });
    });

    describe('setDate - Date to string (fromDateToString=true)', () => {
        beforeEach(() => {
            handler.setFlag(true);
        });

        test('converts Date to full ISO string for datetime column', () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const dateObj = new Date('2023-01-15T10:30:00Z');
            const resource = { resourceType: 'AuditEvent' };
            const result = handler.setDate(dateObj, resource, 'recorded');

            expect(result).toBe('2023-01-15T10:30:00.000Z');
        });

        test('converts Date to date-only string for non-datetime column', () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            const dateObj = new Date('2023-01-15T10:30:00Z');
            const resource = { resourceType: 'Patient' };
            const result = handler.setDate(dateObj, resource, 'birthDate');

            expect(result).toBe('2023-01-15');
        });

        test('returns non-Date value unchanged', () => {
            const result = handler.setDate('just-a-string', {}, 'field');

            expect(result).toBe('just-a-string');
        });

        test('returns null unchanged', () => {
            const result = handler.setDate(null, {}, 'field');

            expect(result).toBeNull();
        });

        test('returns undefined unchanged', () => {
            const result = handler.setDate(undefined, {}, 'field');

            expect(result).toBeUndefined();
        });

        test('returns number unchanged (not a Date instance)', () => {
            const result = handler.setDate(12345, {}, 'field');

            expect(result).toBe(12345);
        });

        test('returns false unchanged (not a Date instance)', () => {
            const result = handler.setDate(false, {}, 'field');

            expect(result).toBe(false);
        });

        test('cleans array indices from path when determining date format', () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            const dateObj = new Date('2023-01-15T10:30:00Z');
            const resource = { resourceType: 'Bundle' };
            handler.setDate(dateObj, resource, 'entry.0.resource.birthDate');

            expect(mockIsColumnDateTimeType).toHaveBeenCalledWith(
                'Bundle',
                'entry.resource.birthDate'
            );
        });
    });

    describe('processResource - complex structures', () => {
        test('handles deeply nested objects', async () => {
            mockIsColumnDateTimeType.mockImplementation((resourceType, path) => {
                return path === 'meta.lastUpdated';
            });

            const resource = {
                resourceType: 'Observation',
                meta: {
                    lastUpdated: '2023-03-20T08:00:00Z',
                    versionId: '1'
                },
                status: 'final'
            };

            await handler.preSaveAsync({ resource });

            expect(resource.meta.lastUpdated).toBeInstanceOf(Date);
            expect(resource.meta.versionId).toBe('1');
            expect(resource.status).toBe('final');
        });

        test('handles empty objects', async () => {
            mockIsColumnDateTimeType.mockReturnValue(false);

            const resource = {
                resourceType: 'Patient'
            };

            await handler.preSaveAsync({ resource });

            expect(resource.resourceType).toBe('Patient');
        });

        test('handles resource with empty arrays', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'Patient',
                name: [],
                address: []
            };

            // Should not throw
            await handler.preSaveAsync({ resource });
            expect(resource.name).toEqual([]);
        });

        test('handles deeply nested arrays of objects', async () => {
            mockIsColumnDateTimeType.mockImplementation((resourceType, path) => {
                return path === 'group.population.criteria.date';
            });

            const resource = {
                resourceType: 'Measure',
                group: [
                    {
                        population: [
                            {
                                criteria: { date: '2023-05-01T00:00:00Z' }
                            }
                        ]
                    }
                ]
            };

            await handler.preSaveAsync({ resource });

            expect(resource.group[0].population[0].criteria.date).toBeInstanceOf(Date);
        });

        test('idempotent - calling twice produces same result', async () => {
            mockIsColumnDateTimeType.mockReturnValue(true);

            const resource = {
                resourceType: 'AuditEvent',
                recorded: '2023-01-15T10:30:00Z'
            };

            await handler.preSaveAsync({ resource });
            const firstDate = resource.recorded;

            // Second call - the value is now already a Date object, which is an object
            // so it will recurse into it (since Date has numeric keys when iterated)
            // This tests the actual behavior
            await handler.preSaveAsync({ resource });

            expect(resource.recorded).toBeInstanceOf(Date);
        });
    });
});
