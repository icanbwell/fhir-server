const { groupByLambda } = require('../../../utils/list.util');
const { ReferenceParser } = require('../../../utils/referenceParser');

/**
 * Map of id -> id, resourceType and sourceAssigningAuthority
 * @typedef {{ id: string; resourceType: string; sourceAssigningAuthority: string | undefined }} IReference
 * @typedef {IReference[]} IReferences
 */

/**
 * Create filter from references based on _uuid, _sourceId and _sourceAssigningAuthority
 */
class SearchFilterFromReference {
  /**
   * Build search query from idToRefMap for given property
   * if property name is not passed, then filter will be base on _uuid and _sourceId
   * @example
   * ```js
   * const idToRefMap = {
   *    'patientId1': { id: 'patientId1', resourceType: 'Patient', sourceAssigningAuthority: 'client-1' }
   *    'bb7862e6-b7ac-470e-bde3-e85cee9d1ce6': { id: 'bb7862e6-b7ac-470e-bde3-e85cee9d1ce6', resourceType: 'Patient' }
   * }
   *
   * // query generated will be
   * [{
   *   '_uuid': { '$in': ['bb7862e6-b7ac-470e-bde3-e85cee9d1ce6']},
   * }, {
   *   '$and': [
   *      { '_sourceId': { '$in': ['bb7862e6-b7ac-470e-bde3-e85cee9d1ce6']}, },
   *      { '_sourceAssigningAuthority': 'client-1' },
   *   ]
   * }]
   * ```
   * @param {IReferences} references Array of references
   * @param {string|undefined|null} property Related property name to make query on. Query will be based on property._uuid or property._sourceId
   * @returns {{[field: string]: { ['$in']: string[]}}} Array of filter queries generated using property name and idToRefMap
   */
  static buildFilter(references, property) {
    const prop = property ? `${property}.` : '';
    const includePrefix = !!property;

    const filters = [];
    const uuidOrItsRefs = [];
    const sourceIdOrItsRefs = [];
    const sourceIdOrItsRefWithSourceAssigningAuthority = [];

    // separate all types of references
    references.forEach((reference) => {
      const { id, resourceType, sourceAssigningAuthority } = reference;
      if (ReferenceParser.isUuidReference(id)) {

        const uuidToPush = includePrefix ? ReferenceParser.createReference({ id, resourceType }) : id;
        // add ResourceType/id
        uuidOrItsRefs.push(uuidToPush);
      } else {
        if (sourceAssigningAuthority) {
          // push ResourceType/id|sourceAssigningAuthority
          const idToPush = includePrefix ? ReferenceParser.createReference({ id, resourceType, sourceAssigningAuthority }) :
            ReferenceParser.createReference({ id, sourceAssigningAuthority });
          sourceIdOrItsRefWithSourceAssigningAuthority
            .push(idToPush);
        } else {
          const sourceIdToPush = includePrefix ? ReferenceParser.createReference({ id, resourceType }) : id;
          // push to non uuids as ResourceType/id
          sourceIdOrItsRefs.push(sourceIdToPush);
        }
      }
    });

    /**
     * Group on basis of sourceAssigningAuthority
     * @type {{[sourceAssigningAuthority: string]: string[]}}
     */
    const groupOfIdOrItsRefsWithSourceAssigningAuthority = groupByLambda(
      sourceIdOrItsRefWithSourceAssigningAuthority,
      idOrRef => ReferenceParser.getSourceAssigningAuthority(idOrRef)
    );

    // add uuid filter
    filters.push({
      [`${prop}_uuid`]: {
        '$in': uuidOrItsRefs
      }
    });

    // add sourceId filter
    filters.push({
      [`${prop}_sourceId`]: {
        '$in': sourceIdOrItsRefs
      }
    });

    // sourceId + sourceAssigning Authority
    Object.entries(groupOfIdOrItsRefsWithSourceAssigningAuthority)
      .forEach(([sourceAssigningAuthority, idOrItsRefWithSourceAssigningAuthority]) => {
        filters.push(
          {
            '$and': [
              {
                [`${prop}_sourceAssigningAuthority`]: sourceAssigningAuthority
              },
              {
                [`${prop}_sourceId`]: {
                  // for Patient/id|client -> Patient/id and for id|client -> id
                  '$in': idOrItsRefWithSourceAssigningAuthority.flatMap((ref) => ReferenceParser.createReferenceWithoutSourceAssigningAuthority(ref))
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
