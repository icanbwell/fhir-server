const assert = require('node:assert/strict');

function assertTypeEquals(obj, type) {
    assert(obj);
    assert(obj instanceof type);
}

module.exports = {
    assertTypeEquals
};
