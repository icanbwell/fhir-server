/* eslint-disable no-unused-vars */
/**
 * helper function to check health of mongoDB connection
 */

const env = require('var');
const { isTrue } = require('./isTrue');
const {Kafka} = require('kafkajs');
const {RethrownError} = require('./rethrownError');
const {KAFKA_CONNECTION_HEALTHCHECK_INTERVAL} = require('../constants');
const {assertTypeEquals, assertIsValid} = require('./assertType');
const {DatabaseQueryFactory} = require('../dataLayer/databaseQueryFactory');
const superagent = require('superagent');
const {ConfigManager} = require('./configManager');
const OperationOutcome = require('../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const {logInfo} = require('../operations/common/logging');

let kafkaClientFactory;
let kafkaClient;
let timeTillKafkaReconnection;
let producer;
let container;
/**
 * @type {{sasl: {accessKeyId: (string|null), secretAccessKey: (string|null), authorizationIdentity: (string|undefined), password: (string|null), mechanism: (string|undefined), username: (string|null)}, clientId: (string|undefined), brokers: string[], ssl: boolean}}
 */
let config;


