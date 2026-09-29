const { describe, test, expect, afterEach, jest } = require('@jest/globals');

describe('fhirNotesMongoConfig', () => {
    const ORIGINAL_ENV = process.env;

    afterEach(() => {
        process.env = ORIGINAL_ENV;
        jest.resetModules();
    });

    test('has no connection when FHIR_NOTES_MONGO_URL is unset', () => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
        delete process.env.FHIR_NOTES_MONGO_URL;
        const { fhirNotesMongoConfig } = require('../../../config');
        expect(fhirNotesMongoConfig.connection).toBeUndefined();
    });

    test('builds connection/db_name/collection_name/index_name from env when set', () => {
        jest.resetModules();
        process.env = {
            ...ORIGINAL_ENV,
            FHIR_NOTES_MONGO_URL: 'mongodb://fhir-notes-host:27017',
            FHIR_NOTES_MONGO_DB_NAME: 'fhir_notes',
            FHIR_NOTES_MONGO_COLLECTION_NAME: 'clinical_notes',
            FHIR_NOTES_TEXT_SEARCH_INDEX_NAME: 'fhir-notes-text-search'
        };
        const { fhirNotesMongoConfig } = require('../../../config');
        expect(fhirNotesMongoConfig.connection).toEqual('mongodb://fhir-notes-host:27017');
        expect(fhirNotesMongoConfig.db_name).toEqual('fhir_notes');
        expect(fhirNotesMongoConfig.collection_name).toEqual('clinical_notes');
        expect(fhirNotesMongoConfig.index_name).toEqual('fhir-notes-text-search');
    });

    test('embeds username/password into the connection string when provided', () => {
        jest.resetModules();
        process.env = {
            ...ORIGINAL_ENV,
            FHIR_NOTES_MONGO_URL: 'mongodb://fhir-notes-host:27017',
            FHIR_NOTES_MONGO_USERNAME: 'reader',
            FHIR_NOTES_MONGO_PASSWORD: 'secret',
            FHIR_NOTES_MONGO_DB_NAME: 'fhir_notes',
            FHIR_NOTES_MONGO_COLLECTION_NAME: 'clinical_notes',
            FHIR_NOTES_TEXT_SEARCH_INDEX_NAME: 'fhir-notes-text-search'
        };
        const { fhirNotesMongoConfig } = require('../../../config');
        expect(fhirNotesMongoConfig.connection).toContain('reader:secret@');
    });
});
