function assertTypeEquals(obj, type) {
    if (!obj) {
        throw new Error(`obj of type ${type} is null or undefined`);
    }
    if (!(obj instanceof type)) {
        throw new Error(`Type of obj ${typeof obj} is not the expected type ${type}`);
    }
}

module.exports = {
    assertTypeEquals
};
