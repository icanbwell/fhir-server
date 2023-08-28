/**
 * https://www.beyondjava.net/elvis-operator-aka-safe-navigation-javascript-typescript
 * @param obj
 * @returns {*}
 */
function safeReference(obj) {
    return new Proxy(obj, {
        get: function (target, name) {
            const result = target[`${name}`];
            if (!result) {
                return (result instanceof Object) ? safeReference(result) : result;
            }
            return safeReference({});
        }
    });
}

module.exports = {
    safeReference
};
