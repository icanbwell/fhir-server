const { removeDuplicatesWithLambda } = require('./list.util');

class MongoQuerySimplifier {
    /**
     * simplifies the filter by removing duplicate segments and $or statements with just one child
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>|null} filter
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>|null}
     */
    static simplifyFilter ({ filter }) {
        if (filter === null || filter === undefined) {
            return filter;
        }
        // simplify $or
        if (filter.$or && filter.$or.length > 1) {
            filter.$or = removeDuplicatesWithLambda(filter.$or,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        // remove nested $or if there is a parent $or
        if (filter.$or && filter.$or.length > 0) {
            filter.$or = filter.$or.map(f => this.simplifyFilter({ filter: f }));
            const indexesToSplice = [];
            for (const [subFilterIndex, subFilter] of filter.$or.entries()) {
                if (this.isFilter(subFilter) && subFilter.$or) {
                    const orFilters = subFilter.$or;

                    orFilters.forEach(af => filter.$or.push(af));
                    indexesToSplice.push(subFilterIndex);
                }
            }
            if (indexesToSplice.length > 0) {
                filter.$or = filter.$or.filter((item, index) => !indexesToSplice.includes(index));
            }
            let key = null;
            let updateOrFilter = true;
            const valuesInSubFilters = {};
            // Turn $or into $in if there are common fields and the filters are strings
            for (const subFilter of filter.$or) {
                if (subFilter && this.isFilter(subFilter)) {
                    const keysForSubFilter = Object.keys(subFilter);
                    key = keysForSubFilter[0];
                    const subFilterValue = subFilter[keysForSubFilter[0]];

                    if (keysForSubFilter.length !== 1 || (Array.isArray(subFilterValue)) || (this.isFilter(subFilterValue))) {
                        updateOrFilter = false;
                        break;
                    }
                    if (!valuesInSubFilters[key]) {
                        valuesInSubFilters[key] = [];
                    }
                    valuesInSubFilters[key].push(subFilterValue);
                }
            }
            if (updateOrFilter) {
                // if there are multiple keys, we need to create a $or filter for each key
                if(Object.keys(valuesInSubFilters).length > 1) {
                    const orFilters = [];
                    for (const [key, values] of Object.entries(valuesInSubFilters)) {
                        let orFilter = {};
                        if (values.length === 1) {
                            orFilter[key] = values[0];
                        } else {
                            orFilter[key] = {
                                $in: values
                            };
                        }
                        orFilters.push(orFilter);
                    }
                    filter.$or = orFilters;
                }
                // if there is only one key, we can just use $in and remove the $or
                else if (Object.keys(valuesInSubFilters).length === 1) {
                    for (const [key, values] of Object.entries(valuesInSubFilters)) {
                        delete filter.$or;
                        if (values.length === 1) {
                            filter[key] = values[0];
                        } else {
                            filter[key] = {
                                $in: values
                            };
                        }
                    }
                }
            }
        }

        if (filter.$or && filter.$or.length === 1 && Object.keys(filter).length === 1) {
            filter = filter.$or[0];
        }
        // simplify $nor
        if (filter.$nor && filter.$nor.length > 1) {
            filter.$nor = removeDuplicatesWithLambda(filter.$nor,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        if (filter.$nor && filter.$nor.length > 0) {
            filter.$nor = filter.$nor.map(f => this.simplifyFilter({ filter: f }));
        }
        // simplify $and
        if (filter.$and && filter.$and.length > 1) {
            filter.$and = removeDuplicatesWithLambda(filter.$and,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        if (filter.$and && filter.$and.length > 0) {
            filter.$and = filter.$and.map(f => this.simplifyFilter({ filter: f }));
            const indexesToSplice = [];
            for (const [subFilterIndex, subFilter] of filter.$and.entries()) {
                if (this.isFilter(subFilter) && subFilter.$and) {
                    const andFilters = subFilter.$and;

                    andFilters.forEach(af => filter.$and.push(af));
                    indexesToSplice.push(subFilterIndex);
                }
            }
            if (indexesToSplice.length > 0) {
                filter.$and = filter.$and.filter((item, index) => !indexesToSplice.includes(index));
            }
        }
        // if there are $and filters inside this $and then promote them to the same level
        if (filter.$and && filter.$and.length === 1 && Object.keys(filter).length === 1) {
            filter = filter.$and[0];
        }

        if (filter?.$in && filter?.$in.length > 1) {
            filter.$in = removeDuplicatesWithLambda(filter.$in,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }

        // simplify $in
        if (filter?.$in && filter.$in.length === 1 && Object.keys(filter).length === 1) {
            filter = filter.$in[0];
        }

        if (filter) {
            // recurse into non-mongo filters
            for (const [key, value] of Object.entries(filter)) {
                if (!['$and', '$in', '$or', '$nor'].includes(key) && value) {
                    if (this.isFilter(value)) {
                        filter[`${key}`] = this.simplifyFilter({ filter: value });
                    }
                }
            }

            for (const [key, value] of Object.entries(filter)) {
                if (Array.isArray(value)) {
                    filter[`${key}`] = value.map(v => this.simplifyFilter({ filter: v }))
                        .filter(v => !this.isEmpty(v));
                    if (filter[`${key}`].length === 0) {
                        delete filter[`${key}`]; // remove empty clauses
                    }
                } else if (this.isFilter(value)) {
                    filter[`${key}`] = this.simplifyFilter({ filter: value });
                    if (this.isEmpty(filter[`${key}`])) {
                        delete filter[`${key}`]; // remove empty clauses
                    }
                }
            }
        }

        return filter;
    }

    /**
     * whether the passed object/array is empty
     * @param {*} value
     * @return {boolean}
     */
    static isEmpty (value) {
        if (!value) {
            return true;
        }
        if (Array.isArray(value) && value.length === 0) {
            return true;
        }
        return this.isFilter(value) && Object.keys(value).length === 0;
    }

    /**
     * Returns whether value is a filter
     * @param {*} value
     * @return {boolean}
     */
    static isFilter (value) {
        return !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp) && (value instanceof Object);
    }

    /**
     * finds all columns being used in the filter
     * @param {string|undefined} [parentKey]
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} filter
     * @return {Set<string>}
     */
    static findColumnsInFilter ({ parentKey, filter }) {
        const columns = new Set();
        if (!this.isFilter(filter)) {
            return columns;
        }
        const parentColumns = new Set();
        const columnsForChildren = new Set();
        for (const [operator, subFilter] of Object.entries(filter)) {
            let newParentKey = parentKey;

            if (!operator.startsWith('$')) {
                if (parentKey) {
                    newParentKey = `${parentKey}.${operator}`;
                } else {
                    newParentKey = operator;
                }
                parentColumns.add(newParentKey);
            }
            if (Array.isArray(subFilter)) {
                const newColumns = subFilter.flatMap(

                    sf => Array.from(
                        this.findColumnsInFilter(
                            {
                                parentKey: newParentKey,
                                filter: sf
                            }
                        )
                    )
                );
                newColumns.forEach(c => columnsForChildren.add(c));
            } else if (this.isFilter(subFilter)) {
                const newColumns = this.findColumnsInFilter(
                    {
                        parentKey: newParentKey,
                        filter: subFilter
                    }
                );
                newColumns.forEach(c => columnsForChildren.add(c));
            }
        }
        if (columnsForChildren.size > 0) {
            columnsForChildren.forEach(c => columns.add(c));
        } else if (parentColumns.size > 0) {
            parentColumns.forEach(c => columns.add(c));
        }
        return columns;
    }
}

module.exports = {
    MongoQuerySimplifier
};
