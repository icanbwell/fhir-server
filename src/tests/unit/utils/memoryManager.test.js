'use strict';

const { describe, test, expect } = require('@jest/globals');
const { MemoryManager } = require('../../../utils/memoryManager');

describe('MemoryManager', () => {
    const manager = new MemoryManager();

    describe('formatBytes', () => {
        test('returns "0 Bytes" for zero', () => {
            expect(manager.formatBytes(0)).toBe('0 Bytes');
        });

        test('returns "0 Bytes" for null/undefined', () => {
            expect(manager.formatBytes(null)).toBe('0 Bytes');
            expect(manager.formatBytes(undefined)).toBe('0 Bytes');
        });

        test('formats bytes correctly', () => {
            expect(manager.formatBytes(500)).toBe('500 Bytes');
        });

        test('formats kilobytes', () => {
            expect(manager.formatBytes(1024)).toBe('1 KB');
        });

        test('formats megabytes', () => {
            expect(manager.formatBytes(1048576)).toBe('1 MB');
        });

        test('formats gigabytes', () => {
            expect(manager.formatBytes(1073741824)).toBe('1 GB');
        });

        test('respects decimals parameter', () => {
            expect(manager.formatBytes(1536, 1)).toBe('1.5 KB');
        });

        test('uses 2 decimal places by default', () => {
            const result = manager.formatBytes(1500);
            expect(result).toBe('1.46 KB');
        });

        test('handles negative decimals as 0', () => {
            expect(manager.formatBytes(1536, -1)).toBe('2 KB');
        });
    });

    describe('memoryUsed', () => {
        test('returns a string with memory unit', () => {
            const result = manager.memoryUsed;
            expect(typeof result).toBe('string');
            expect(result).toMatch(/\d+(\.\d+)?\s+(Bytes|KB|MB|GB|TB)/);
        });
    });
});
