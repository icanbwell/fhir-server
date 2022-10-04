const {customIndexes} = require('./customIndexes');

class IndexProvider {
    getIndexes() {
        return customIndexes;
    }
}

module.exports = {
    IndexProvider
};
