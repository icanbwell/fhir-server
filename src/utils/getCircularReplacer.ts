/**
 * replaces circular references
 * inspired by: https://bobbyhadz.com/blog/javascript-typeerror-converting-circular-structure-to-json
 * @return {function(string, *): *}
 */
function getCircularReplacer() {
    const seen = new WeakSet();
    return (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    };
}

module.exports = {
    getCircularReplacer
};
