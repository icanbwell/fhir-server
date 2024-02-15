const {mongoQueryAndOptionsStringify} = require('./mongoQueryStringify');
const {QueryItem} = require('../operations/graph/queryItem');

/**
 * This file implements a custom error for Mongo errors
 */

class MongoError extends AggregateError {
    /**
     * Creates an error for mongo
     * @param {string} requestId
     * @param {string} message
     * @param {Error} error
     * @param {string} collection
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {*} options
     * @param {number} elapsedTime
     */
    constructor (requestId, message, error, collection, query, elapsedTime, options = {}) {
        const elapsedTimeInSecs = (elapsedTime) / 1000;
        super(
            [error],
            message + ': ' + (error.message || '') + ': ' +
            mongoQueryAndOptionsStringify(
                {
                    query: new QueryItem(
                        {
                            query,
                            collectionName: collection,
                            resourceType: null
                        }
                    ),
                    options
                }
            ) + ' , ' +
            ` [elapsedTime=${elapsedTimeInSecs} secs]`
        );
        this.collection = collection;
        this.requestId = requestId;
        this.query = query;
        this.options = options;
        this.elapsedTimeInSecs = elapsedTimeInSecs;
        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
        if (!error) {
            throw new Error('MongoError requires a message and error');
        }
        this.original_error = error;
        this.statusCode = error.statusCode;
        this.message = message || error.message;

        this.stack_before_rethrow = this.stack;
        const message_lines = (message.match(/\n/g) || []).length + 1;
        this.stack = this.stack.split('\n').slice(0, message_lines + 1).join('\n') + '\n' +
            error.stack;
    }
}

class MongoMergeError extends AggregateError {
    /**
     * Creates an error for mongo merge
     * @param {string} requestId
     * @param {string} message
     * @param {Error} error
     * @param {string} resourceType
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} query
     * @param {*} options
     * @param {number} elapsedTime
     */
    constructor (requestId, message, error, resourceType, query, elapsedTime, options = {}) {
        const elapsedTimeInSecs = (elapsedTime) / 1000;
        super(
            [error],
            message + ': ' + (error.message || '') + ': ' +
            mongoQueryAndOptionsStringify(
                {
                    query: new QueryItem(
                        {
                            query,
                            collectionName: null,
                            resourceType
                        }
                    ),
                    options
                }
            ) +
            ` [elapsedTime=${elapsedTimeInSecs} secs]`
        );
        this.resourceType = resourceType;
        this.query = query;
        this.requestId = requestId;
        this.options = options;
        this.elapsedTimeInSecs = elapsedTimeInSecs;
        for (const [key, value] of Object.entries(options)) {
            this[`${key}`] = value;
        }
        if (!error) {
            throw new Error('MongoMergeError requires a message and error');
        }
        this.original_error = error;
        this.message = message || error.message;
        this.statusCode = error.statusCode;
        this.stack_before_rethrow = this.stack;
        const message_lines = (message.match(/\n/g) || []).length + 1;
        this.stack = this.stack.split('\n').slice(0, message_lines + 1).join('\n') + '\n' +
            error.stack;
    }
}

module.exports = {
    MongoError,
    MongoMergeError
};
