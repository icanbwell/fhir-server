const { groupByLambda } = require('./list.util');
const { ReferenceParser } = require('./referenceParser');

/**
 * Map of id -> id, resourceType and sourceAssigningAuthority
 * @typedef {{[id: string]: { id: string; resourceType: string; sourceAssigningAuthority: string | undefined }} IdToReferenceMap
 */

/**
 * Create filter from references based on _uuid, _sourceId and _sourceAssigningAuthority
 */
class SearchFilterFromReference {
  /**
   * Build search query from idToRefMap for given property
   * if property name is not passed, then filter will be base on _uuid and _sourceId
   * @param {IdToReferenceMap} idToRefMap id -> Ref Map
   * @param {string|undefined|null} property Related property name to make query on. Query will be based on property._uuid or property._sourceId
   * @returns {{[field: string]: { ['$in']: string[]}}} Array of filter queries generated using property name and idToRefMap
   */
  static buildFilter(idToRefMap, property) {
    const ids = Object.keys(idToRefMap);
    const prop = property ? `${property}.` : '';
    const includePrefix = !!property;

    const filters = [];
    const uuidsRefs = [];
    const nonUuidsRefs = [];
    const nonUuidRefsWithSourceAssigningAuthority = [];

    // separate all types of references
    ids.forEach((id) => {
      if (ReferenceParser.isUuidReference(id)) {
        const { resourceType } = idToRefMap[`${id}`];
        // add ResourceType/id
        uuidsRefs.push(ReferenceParser.createReference({
          id,
          resourceType,
        }));
      } else {
        const ref = idToRefMap[`${id}`];
        if (ref && ref.sourceAssigningAuthority) {
          const { resourceType } = ref;
          // push ResourceType/id|sourceAssigningAuthority
          nonUuidRefsWithSourceAssigningAuthority
            .push(ReferenceParser.createReference({ resourceType, id, sourceAssigningAuthority: ref.sourceAssigningAuthority }));
        } else {
          const { resourceType } = idToRefMap[`${id}`];
          // push to non uuids as ResourceType/id
          nonUuidsRefs.push(ReferenceParser.createReference({ resourceType, id }));
        }
      }
    });

    /**
     * Group on basis of sourceAssigningAuthority
     * @type {{[sourceAssigningAuthority: string]: string[]}}
     */
    const groupOfIdsWithSourceAssigningAuthority = groupByLambda(
      nonUuidRefsWithSourceAssigningAuthority,
      r => ReferenceParser.getSourceAssigningAuthority(r)
    );

    // add uuid filter
    filters.push({
      [`${prop}_uuid`]: {
        '$in': includePrefix ? [...uuidsRefs] : uuidsRefs.map(u => ReferenceParser.parseReference(u).id)
      }
    });

    // add sourceId filter
    filters.push({
      [`${prop}_sourceId`]: {
        '$in': includePrefix ? [...nonUuidsRefs] : nonUuidsRefs.map(u => ReferenceParser.parseReference(u).id)
      },
    });

    // sourceId + sourceAssigning Authority
    Object.entries(groupOfIdsWithSourceAssigningAuthority)
      .forEach(([sourceAssigningAuthority, referenceWithSourceAssigningAuthority]) => {
        filters.push(
          {
            '$and': [
              {
                [`${prop}_sourceAssigningAuthority`]: sourceAssigningAuthority
              },
              {
                [`${prop}_sourceId`]: {
                  '$in': includePrefix ?
                    referenceWithSourceAssigningAuthority.flatMap(r => ReferenceParser.createReferenceWithoutSourceAssigningAuthority(r)) :
                    referenceWithSourceAssigningAuthority.flatMap(r => ReferenceParser.parseReference(r).id)
                    .map((r) => r)
                }
              }
            ]
          }
        );
      });
    return filters;
  }
}

module.exports = { SearchFilterFromReference };
