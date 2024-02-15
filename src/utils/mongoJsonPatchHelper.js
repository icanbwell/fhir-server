function toDot (path) {
    return path.replace(/^\//, '').replace(/\//g, '.').replace(/~1/g, '/').replace(/~0/g, '~');
}

class MongoJsonPatchHelper {
    /**
     * converts a json patch to a mongo update command
     * @param {import('fast-json-patch').Operation[]} patches
     * @return {{}}
     */
    static convertJsonPatchesToMongoUpdateCommand (
        {
            patches
        }
    ) {
        const update = {};
        patches.map(function (patch) {
            switch (patch.op) {
                case 'add': {
                    const path = toDot(patch.path);
                    const parts = path.split('.');

                    let positionPart = parts.length > 1 && parts[parts.length - 1];
                    let addToEnd = positionPart === '-';
                    let key = parts.slice(0, -1).join('.');
                    if (Number.isNaN(parseInt(positionPart))) {
                        addToEnd = true;
                        positionPart = '';
                        key = parts.join('.');
                    }
                    const $position = positionPart && parseInt(positionPart, 10) || null;

                    update.$push = update.$push || {};

                    if ($position !== null) {
                        if (update.$push[`${key}`] === undefined) {
                            update.$push[`${key}`] = {
                                $each: [patch.value],
                                $position
                            };
                        } else {
                            if (update.$push[`${key}`] === null || update.$push[`${key}`].$position === undefined) {
                                throw new Error('Unsupported Operation! can\'t use add op with mixed positions');
                            }
                            const posDiff = $position - update.$push[`${key}`].$position;
                            if (posDiff > update.$push[`${key}`].$each.length) {
                                throw new Error('Unsupported Operation! can use add op only with contiguous positions');
                            }
                            update.$push[`${key}`].$each.splice(posDiff, 0, patch.value);
                            update.$push[`${key}`].$position = Math.min($position, update.$push[`${key}`].$position);
                        }
                    } else if (addToEnd) {
                        if (update.$push[`${key}`] === undefined) {
                            update.$push[`${key}`] = patch.value;
                        } else {
                            if (update.$push[`${key}`] === null || update.$push[`${key}`].$each === undefined) {
                                update.$push[`${key}`] = {
                                    $each: [update.$push[`${key}`]]
                                };
                            }
                            if (update.$push[`${key}`].$position !== undefined) {
                                throw new Error('Unsupported Operation! can\'t use add op with mixed positions');
                            }
                            update.$push[`${key}`].$each.push(patch.value);
                        }
                    } else {
                        throw new Error('Unsupported Operation! can\'t use add op without position');
                    }
                    break;
                }
                case 'remove':
                    update.$unset = update.$unset || {};
                    update.$unset[toDot(patch.path)] = 1;
                    break;
                case 'replace':
                    update.$set = update.$set || {};
                    update.$set[toDot(patch.path)] = patch.value;
                    break;
                case 'test':
                    break;
                default:
                    throw new Error('Unsupported Operation! op = ' + patch.op);
            }
            return patch;
        });
        return update;
    }
}

module.exports = {
    MongoJsonPatchHelper
};
