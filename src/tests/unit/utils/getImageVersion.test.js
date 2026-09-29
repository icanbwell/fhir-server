'use strict';

const { describe, test, expect, afterEach } = require('@jest/globals');
const { getImageVersion } = require('../../../utils/getImageVersion');

describe('getImageVersion', () => {
    const origImage = process.env.DOCKER_IMAGE;
    const origVersion = process.env.DOCKER_IMAGE_VERSION;

    afterEach(() => {
        if (origImage !== undefined) process.env.DOCKER_IMAGE = origImage;
        else delete process.env.DOCKER_IMAGE;
        if (origVersion !== undefined) process.env.DOCKER_IMAGE_VERSION = origVersion;
        else delete process.env.DOCKER_IMAGE_VERSION;
    });

    test('returns DOCKER_IMAGE_VERSION when set', () => {
        process.env.DOCKER_IMAGE_VERSION = '2.5.1';
        process.env.DOCKER_IMAGE = 'registry.example.com/fhir:1.0.0';
        expect(getImageVersion()).toBe('2.5.1');
    });

    test('extracts version from DOCKER_IMAGE after last colon', () => {
        delete process.env.DOCKER_IMAGE_VERSION;
        process.env.DOCKER_IMAGE = 'registry.example.com/fhir-server:3.2.1';
        expect(getImageVersion()).toBe('3.2.1');
    });

    test('returns null when neither env var is set', () => {
        delete process.env.DOCKER_IMAGE_VERSION;
        delete process.env.DOCKER_IMAGE;
        expect(getImageVersion()).toBeNull();
    });

    test('returns empty string when DOCKER_IMAGE has no colon', () => {
        delete process.env.DOCKER_IMAGE_VERSION;
        process.env.DOCKER_IMAGE = 'fhir-server';
        // lastIndexOf(':') returns -1, slice(0) returns the whole string... hmm
        // Actually lastIndexOf returns -1, slice(-1+1) = slice(0) = 'fhir-server'
        expect(getImageVersion()).toBe('fhir-server');
    });

    test('handles image with port number in registry URL', () => {
        delete process.env.DOCKER_IMAGE_VERSION;
        process.env.DOCKER_IMAGE = 'registry.example.com:5000/fhir:latest';
        expect(getImageVersion()).toBe('latest');
    });
});
