const crypto = require('node:crypto');
const { assertIsValid } = require('./assertType');

const generateNonce = (size = 16) => {
  assertIsValid(Number.isInteger(size));
  return crypto.randomBytes(size).toString('base64');
};

module.exports = { generateNonce };
