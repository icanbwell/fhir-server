# Composition Sensitive Section Filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip sections from FHIR Composition resources at serialization time when their `code.coding` contains the sensitive system (`https://www.icanbwell.com/sensitivity-category`), recursively across all nesting levels.

**Architecture:** A custom filter function (`compositionSectionFilter.js`) is called from the Composition serializer — the same pattern as `enrichReferenceExtension` in the Reference serializer. The filter is enabled via a ConfigManager flag stored in `httpContext` so the serializer can read it without signature changes. Phase 1 is a blanket strip; phase 2 (future) will read `deniedSensitiveCategories` from httpContext for consent-based filtering.

**Tech Stack:** Node.js/CommonJS, express-http-context, Jest + MongoDB Memory Server

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/fhir/serializers/4_0_0/custom_utils/compositionSectionFilter.js` | **CREATE** | Recursive section filtering logic — reads httpContext for feature flag |
| `src/fhir/serializers/4_0_0/resources/composition.js` | **MODIFY** | Call `filterCompositionSections` before serializing `section` property |
| `src/constants.js` | **MODIFY** | Add `COMPOSITION_SENSITIVE_SECTION_FILTERING` to `HTTP_CONTEXT_KEYS` |
| `src/utils/configManager.js` | **MODIFY** | Add `enableCompositionSensitiveSectionFiltering` getter |
| `src/app.js` | **MODIFY** | Set httpContext flag from configManager for every request |
| `src/tests/serializer/compositionSectionFilter/compositionSectionFilter.test.js` | **CREATE** | Unit tests for the filter function |
| `src/tests/serializer/compositionSectionFilter/fixtures/compositionWithSensitiveSections.json` | **CREATE** | Test fixture — Composition with sensitive + non-sensitive sections |
| `src/tests/serializer/compositionSectionFilter/fixtures/expectedFilteredComposition.json` | **CREATE** | Expected output after filtering |

---

### Task 1: Create the compositionSectionFilter utility

**Files:**
- Create: `src/fhir/serializers/4_0_0/custom_utils/compositionSectionFilter.js`
- Create: `src/tests/serializer/compositionSectionFilter/compositionSectionFilter.test.js`
- Create: `src/tests/serializer/compositionSectionFilter/fixtures/compositionWithSensitiveSections.json`
- Create: `src/tests/serializer/compositionSectionFilter/fixtures/expectedFilteredComposition.json`

- [ ] **Step 1: Create the test fixture — Composition with sensitive sections**

Create `src/tests/serializer/compositionSectionFilter/fixtures/compositionWithSensitiveSections.json`:

```json
{
    "resourceType": "Composition",
    "id": "test-composition-1",
    "meta": {
        "source": "https://www.icanbwell.com/fhir-composition-service",
        "security": [
            {
                "system": "https://www.icanbwell.com/owner",
                "code": "bwell"
            },
            {
                "system": "https://www.icanbwell.com/access",
                "code": "bwell"
            }
        ]
    },
    "status": "preliminary",
    "type": {
        "coding": [
            {
                "system": "https://fhir.icanbwell.com/4_0_0/CodeSystem/composition",
                "code": "immunization_summary_document"
            }
        ]
    },
    "subject": {
        "reference": "Patient/person.test-person-1"
    },
    "date": "2026-04-08T16:59:07.190912+00:00",
    "author": [
        {
            "reference": "Organization/test-org-1",
            "type": "Organization",
            "display": "Test Org"
        }
    ],
    "title": "Immunization Summary",
    "section": [
        {
            "id": "section-hepatitis-p",
            "title": "Hepatitis P",
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/cvx",
                        "code": "Hepatitis P",
                        "display": "Hepatitis P"
                    }
                ]
            },
            "mode": "working",
            "entry": [
                {
                    "reference": "Immunization/imm-1",
                    "type": "Immunization"
                }
            ],
            "section": [
                {
                    "id": "sub-imm-name",
                    "title": "Immunization Name",
                    "text": {
                        "status": "generated",
                        "div": "Hepatitis P"
                    }
                },
                {
                    "id": "sub-source",
                    "title": "Source",
                    "text": {
                        "status": "generated",
                        "div": "bwell_test"
                    }
                },
                {
                    "id": "sub-sensitivity",
                    "title": "Sensitivity",
                    "code": {
                        "coding": [
                            {
                                "system": "https://www.icanbwell.com/sensitivity-category",
                                "code": "HL-SENS-HEPAT"
                            },
                            {
                                "system": "https://www.icanbwell.com/sensitivity-category",
                                "code": "HL-SENS-HIVTR"
                            }
                        ]
                    }
                }
            ]
        },
        {
            "id": "section-hepatitis-b",
            "title": "Hepatitis B",
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/cvx",
                        "code": "Hepatitis B",
                        "display": "Hepatitis B"
                    }
                ]
            },
            "mode": "working",
            "entry": [
                {
                    "reference": "Immunization/imm-2",
                    "type": "Immunization"
                }
            ],
            "section": [
                {
                    "id": "sub-imm-name-2",
                    "title": "Immunization Name",
                    "text": {
                        "status": "generated",
                        "div": "Hepatitis B"
                    }
                },
                {
                    "id": "sub-source-2",
                    "title": "Source",
                    "text": {
                        "status": "generated",
                        "div": "bwell_test"
                    }
                }
            ]
        },
        {
            "id": "section-top-level-sensitive",
            "title": "Sensitive Top Level",
            "code": {
                "coding": [
                    {
                        "system": "https://www.icanbwell.com/sensitivity-category",
                        "code": "HL-SENS-ETH"
                    }
                ]
            },
            "mode": "working",
            "entry": [
                {
                    "reference": "Observation/obs-1",
                    "type": "Observation"
                }
            ]
        },
        {
            "id": "section-flu",
            "title": "Flu (Influenza)",
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/cvx",
                        "code": "88",
                        "display": "Flu (Influenza)"
                    }
                ]
            },
            "mode": "working",
            "entry": [
                {
                    "reference": "Immunization/imm-3",
                    "type": "Immunization"
                }
            ]
        }
    ]
}
```

This fixture tests three scenarios:
1. **Hepatitis P** — nested sub-section has sensitive coding (sub-section removed, parent stays)
2. **Sensitive Top Level** — top-level section itself has sensitive coding (entire section removed)
3. **Hepatitis B** and **Flu** — no sensitive coding anywhere (both stay untouched)

- [ ] **Step 2: Create the expected output fixture**

Create `src/tests/serializer/compositionSectionFilter/fixtures/expectedFilteredComposition.json`:

```json
{
    "resourceType": "Composition",
    "id": "test-composition-1",
    "meta": {
        "source": "https://www.icanbwell.com/fhir-composition-service",
        "security": [
            {
                "system": "https://www.icanbwell.com/owner",
                "code": "bwell"
            },
            {
                "system": "https://www.icanbwell.com/access",
                "code": "bwell"
            }
        ]
    },
    "status": "preliminary",
    "type": {
        "coding": [
            {
                "system": "https://fhir.icanbwell.com/4_0_0/CodeSystem/composition",
                "code": "immunization_summary_document"
            }
        ]
    },
    "subject": {
        "reference": "Patient/person.test-person-1"
    },
    "date": "2026-04-08T16:59:07.190912+00:00",
    "author": [
        {
            "reference": "Organization/test-org-1",
            "type": "Organization",
            "display": "Test Org"
        }
    ],
    "title": "Immunization Summary",
    "section": [
        {
            "id": "section-hepatitis-p",
            "title": "Hepatitis P",
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/cvx",
                        "code": "Hepatitis P",
                        "display": "Hepatitis P"
                    }
                ]
            },
            "mode": "working",
            "entry": [
                {
                    "reference": "Immunization/imm-1",
                    "type": "Immunization"
                }
            ],
            "section": [
                {
                    "id": "sub-imm-name",
                    "title": "Immunization Name",
                    "text": {
                        "status": "generated",
                        "div": "Hepatitis P"
                    }
                },
                {
                    "id": "sub-source",
                    "title": "Source",
                    "text": {
                        "status": "generated",
                        "div": "bwell_test"
                    }
                }
            ]
        },
        {
            "id": "section-hepatitis-b",
            "title": "Hepatitis B",
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/cvx",
                        "code": "Hepatitis B",
                        "display": "Hepatitis B"
                    }
                ]
            },
            "mode": "working",
            "entry": [
                {
                    "reference": "Immunization/imm-2",
                    "type": "Immunization"
                }
            ],
            "section": [
                {
                    "id": "sub-imm-name-2",
                    "title": "Immunization Name",
                    "text": {
                        "status": "generated",
                        "div": "Hepatitis B"
                    }
                },
                {
                    "id": "sub-source-2",
                    "title": "Source",
                    "text": {
                        "status": "generated",
                        "div": "bwell_test"
                    }
                }
            ]
        },
        {
            "id": "section-flu",
            "title": "Flu (Influenza)",
            "code": {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/cvx",
                        "code": "88",
                        "display": "Flu (Influenza)"
                    }
                ]
            },
            "mode": "working",
            "entry": [
                {
                    "reference": "Immunization/imm-3",
                    "type": "Immunization"
                }
            ]
        }
    ]
}
```

Key changes from input:
- "Sensitive Top Level" section removed entirely (had sensitive system in its own `code.coding`)
- "Hepatitis P" stays but its "Sensitivity" sub-section is removed
- "Hepatitis B" and "Flu" unchanged

- [ ] **Step 3: Write the failing test**

Create `src/tests/serializer/compositionSectionFilter/compositionSectionFilter.test.js`:

```javascript
const { filterCompositionSections } = require('../../../fhir/serializers/4_0_0/custom_utils/compositionSectionFilter');
const { SENSITIVE_CATEGORY } = require('../../../constants');
const { describe, test, expect } = require('@jest/globals');

describe('compositionSectionFilter', () => {
    describe('filterCompositionSections', () => {
        test('should remove sections with sensitive system in code.coding', () => {
            const sections = [
                {
                    id: 'keep-me',
                    title: 'Normal Section',
                    code: {
                        coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '88' }]
                    }
                },
                {
                    id: 'remove-me',
                    title: 'Sensitive Section',
                    code: {
                        coding: [{ system: SENSITIVE_CATEGORY.SYSTEM, code: 'HL-SENS-ETH' }]
                    }
                }
            ];

            const result = filterCompositionSections(sections);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('keep-me');
        });

        test('should recursively filter nested sections', () => {
            const sections = [
                {
                    id: 'parent',
                    title: 'Parent Section',
                    code: {
                        coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: 'Hep P' }]
                    },
                    section: [
                        {
                            id: 'child-keep',
                            title: 'Immunization Name',
                            text: { status: 'generated', div: 'Hep P' }
                        },
                        {
                            id: 'child-remove',
                            title: 'Sensitivity',
                            code: {
                                coding: [
                                    { system: SENSITIVE_CATEGORY.SYSTEM, code: 'HL-SENS-HEPAT' }
                                ]
                            }
                        }
                    ]
                }
            ];

            const result = filterCompositionSections(sections);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('parent');
            expect(result[0].section).toHaveLength(1);
            expect(result[0].section[0].id).toBe('child-keep');
        });

        test('should return sections unchanged when none have sensitive system', () => {
            const sections = [
                {
                    id: 'sec-1',
                    title: 'Section 1',
                    code: {
                        coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '88' }]
                    }
                },
                {
                    id: 'sec-2',
                    title: 'Section 2'
                }
            ];

            const result = filterCompositionSections(sections);

            expect(result).toHaveLength(2);
        });

        test('should handle sections without code property', () => {
            const sections = [
                {
                    id: 'no-code',
                    title: 'No Code Section',
                    text: { status: 'generated', div: 'Hello' }
                }
            ];

            const result = filterCompositionSections(sections);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('no-code');
        });

        test('should handle null and undefined sections', () => {
            expect(filterCompositionSections(null)).toBeNull();
            expect(filterCompositionSections(undefined)).toBeUndefined();
            expect(filterCompositionSections([])).toEqual([]);
        });

        test('should handle section with code but no coding array', () => {
            const sections = [
                {
                    id: 'code-no-coding',
                    title: 'Has code, no coding',
                    code: { text: 'Some text' }
                }
            ];

            const result = filterCompositionSections(sections);

            expect(result).toHaveLength(1);
        });

        test('should remove section when sensitive system is one of multiple codings', () => {
            const sections = [
                {
                    id: 'mixed-coding',
                    title: 'Mixed Coding',
                    code: {
                        coding: [
                            { system: 'http://hl7.org/fhir/sid/cvx', code: 'Hep P' },
                            { system: SENSITIVE_CATEGORY.SYSTEM, code: 'HL-SENS-HEPAT' }
                        ]
                    }
                }
            ];

            const result = filterCompositionSections(sections);

            expect(result).toHaveLength(0);
        });

        test('should handle deeply nested sections (3 levels)', () => {
            const sections = [
                {
                    id: 'level-1',
                    title: 'Level 1',
                    section: [
                        {
                            id: 'level-2',
                            title: 'Level 2',
                            section: [
                                {
                                    id: 'level-3-keep',
                                    title: 'Level 3 Keep'
                                },
                                {
                                    id: 'level-3-remove',
                                    title: 'Level 3 Remove',
                                    code: {
                                        coding: [
                                            { system: SENSITIVE_CATEGORY.SYSTEM, code: 'HL-SENS-PSY' }
                                        ]
                                    }
                                }
                            ]
                        }
                    ]
                }
            ];

            const result = filterCompositionSections(sections);

            expect(result).toHaveLength(1);
            expect(result[0].section).toHaveLength(1);
            expect(result[0].section[0].section).toHaveLength(1);
            expect(result[0].section[0].section[0].id).toBe('level-3-keep');
        });
    });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/serializer/compositionSectionFilter/compositionSectionFilter.test.js --no-coverage`
Expected: FAIL — `Cannot find module '../../../fhir/serializers/4_0_0/custom_utils/compositionSectionFilter'`

- [ ] **Step 5: Implement compositionSectionFilter.js**

Create `src/fhir/serializers/4_0_0/custom_utils/compositionSectionFilter.js`:

```javascript
const httpContext = require('express-http-context');
const { SENSITIVE_CATEGORY, HTTP_CONTEXT_KEYS } = require('../../../../constants');

/**
 * Checks if a section's code.coding contains the sensitive category system
 * @param {Object} section
 * @returns {boolean}
 */
function sectionHasSensitiveCoding(section) {
    const codings = section.code?.coding;
    if (!Array.isArray(codings)) {
        return false;
    }
    return codings.some(coding => coding.system === SENSITIVE_CATEGORY.SYSTEM);
}

/**
 * Recursively filters out sections whose code.coding contains the sensitive category system.
 * Also recurses into each section's nested section[] array.
 * @param {Object[]|null|undefined} sections
 * @returns {Object[]|null|undefined}
 */
function filterCompositionSections(sections) {
    if (!sections) {
        return sections;
    }

    return sections
        .filter(section => !sectionHasSensitiveCoding(section))
        .map(section => {
            if (section.section) {
                section.section = filterCompositionSections(section.section);
            }
            return section;
        });
}

/**
 * Called from CompositionSerializer.serialize() before section serialization.
 * Reads the feature flag from httpContext. If enabled, strips sensitive sections.
 * @param {Object} rawJson - The raw Composition JSON being serialized
 */
function filterCompositionSensitiveSections(rawJson) {
    if (!rawJson?.section) {
        return;
    }

    const enabled = httpContext.get(HTTP_CONTEXT_KEYS.COMPOSITION_SENSITIVE_SECTION_FILTERING);
    if (!enabled) {
        return;
    }

    rawJson.section = filterCompositionSections(rawJson.section);
}

module.exports = { filterCompositionSections, filterCompositionSensitiveSections };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/serializer/compositionSectionFilter/compositionSectionFilter.test.js --no-coverage`
Expected: PASS — all 8 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/fhir/serializers/4_0_0/custom_utils/compositionSectionFilter.js src/tests/serializer/compositionSectionFilter/
git commit -m "feat: add compositionSectionFilter utility for stripping sensitive sections"
```

---

### Task 2: Add HTTP_CONTEXT_KEYS constant and ConfigManager flag

**Files:**
- Modify: `src/constants.js:155-159`
- Modify: `src/utils/configManager.js` (end of file — add new getter)

- [ ] **Step 1: Add the HTTP_CONTEXT_KEYS constant**

In `src/constants.js`, add `COMPOSITION_SENSITIVE_SECTION_FILTERING` to the `HTTP_CONTEXT_KEYS` object:

```javascript
// Before:
HTTP_CONTEXT_KEYS: {
    LINKED_PATIENTS_FOR_PERSON_PREFIX: 'linkedPatientIdsFor-',
    PERSON_OWNER_PREFIX: 'personOwnerFor-',
    CONSENTED_PROA_DATA_ACCESSED: 'consentedProaDataAccessed'
},

// After:
HTTP_CONTEXT_KEYS: {
    LINKED_PATIENTS_FOR_PERSON_PREFIX: 'linkedPatientIdsFor-',
    PERSON_OWNER_PREFIX: 'personOwnerFor-',
    CONSENTED_PROA_DATA_ACCESSED: 'consentedProaDataAccessed',
    COMPOSITION_SENSITIVE_SECTION_FILTERING: 'compositionSensitiveSectionFiltering'
},
```

- [ ] **Step 2: Add ConfigManager getter**

In `src/utils/configManager.js`, add after the last getter (around line 818):

```javascript
/**
 * @returns {boolean}
 */
get enableCompositionSensitiveSectionFiltering() {
    return isTrue(env.ENABLE_COMPOSITION_SENSITIVE_SECTION_FILTERING);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/constants.js src/utils/configManager.js
git commit -m "feat: add config flag and httpContext key for composition section filtering"
```

---

### Task 3: Set httpContext flag in app.js middleware

**Files:**
- Modify: `src/app.js:247-260`

- [ ] **Step 1: Add httpContext flag after existing httpContext.set calls**

In `src/app.js`, find the middleware block that sets httpContext values (around lines 247-260). After the existing `httpContext.set(REQUEST_ID_TYPE.USER_REQUEST_ID, req.id);` line, add a new middleware that sets the composition filtering flag:

```javascript
// Add this AFTER the existing httpContext middleware block (after line 260)
app.use((req, res, next) => {
    httpContext.set(
        HTTP_CONTEXT_KEYS.COMPOSITION_SENSITIVE_SECTION_FILTERING,
        container1.configManager.enableCompositionSensitiveSectionFiltering
    );
    next();
});
```

Also add `HTTP_CONTEXT_KEYS` to the existing destructured import from constants at the top of the file:

```javascript
const { REQUEST_ID_TYPE, ..., HTTP_CONTEXT_KEYS } = require('../constants');
```

Note: Check the existing imports in `app.js` — `HTTP_CONTEXT_KEYS` may already be imported. If so, no change needed to the import line.

- [ ] **Step 2: Commit**

```bash
git add src/app.js
git commit -m "feat: set composition section filtering flag in httpContext per request"
```

---

### Task 4: Wire filter into CompositionSerializer

**Files:**
- Modify: `src/fhir/serializers/4_0_0/resources/composition.js:159-162,172-206`

- [ ] **Step 1: Add import and filter call to CompositionSerializer**

In `src/fhir/serializers/4_0_0/resources/composition.js`:

Add the import at the top of the file (after line 1, before the existing lazy-load declarations):

```javascript
const { filterCompositionSensitiveSections } = require('../custom_utils/compositionSectionFilter.js');
```

In the `serialize` method (line 172), add the filter call right before the `Object.keys` loop (after the `typeof rawJson !== 'object'` guard at line 181):

```javascript
    static serialize(rawJson) {
        if (!rawJson) return rawJson;

        // Handle array case
        if (Array.isArray(rawJson)) {
            return rawJson.map(item => CompositionSerializer.serialize(item));
        }

        // Handle non-object case
        if (typeof rawJson !== 'object') return rawJson;

        // Filter sensitive sections before serialization
        filterCompositionSensitiveSections(rawJson);

        Object.keys(rawJson).forEach(propertyName => {
            // ... existing code unchanged ...
        });

        return rawJson;
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/fhir/serializers/4_0_0/resources/composition.js
git commit -m "feat: call filterCompositionSensitiveSections in CompositionSerializer"
```

---

### Task 5: Integration test — serializer with httpContext

**Files:**
- Create: `src/tests/serializer/compositionSectionFilter/compositionSectionFilterIntegration.test.js`

- [ ] **Step 1: Write the integration test**

Create `src/tests/serializer/compositionSectionFilter/compositionSectionFilterIntegration.test.js`:

```javascript
const deepcopy = require('deepcopy');
const httpContext = require('express-http-context');
const compositionWithSensitiveSections = require('./fixtures/compositionWithSensitiveSections.json');
const expectedFilteredComposition = require('./fixtures/expectedFilteredComposition.json');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const { HTTP_CONTEXT_KEYS } = require('../../../constants');
const { commonBeforeEach, commonAfterEach, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Composition Serializer — Sensitive Section Filtering Integration', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('should strip sensitive sections when feature flag is enabled', async () => {
        await createTestRequest();

        // Simulate httpContext being set (as app.js middleware does)
        httpContext.set(HTTP_CONTEXT_KEYS.COMPOSITION_SENSITIVE_SECTION_FILTERING, true);

        const input = deepcopy(compositionWithSensitiveSections);
        const result = FhirResourceSerializer.serialize(input);

        // "Sensitive Top Level" section removed (had sensitive system in code.coding)
        // "Hepatitis P" stays but nested "Sensitivity" sub-section removed
        // "Hepatitis B" and "Flu" unchanged
        expect(result.section).toHaveLength(3);
        expect(result.section.map(s => s.id)).toEqual([
            'section-hepatitis-p',
            'section-hepatitis-b',
            'section-flu'
        ]);

        // Verify nested "Sensitivity" sub-section was stripped from Hepatitis P
        const hepatitisP = result.section[0];
        expect(hepatitisP.section).toHaveLength(2);
        expect(hepatitisP.section.map(s => s.id)).toEqual([
            'sub-imm-name',
            'sub-source'
        ]);
    });

    test('should NOT strip sensitive sections when feature flag is disabled', async () => {
        await createTestRequest();

        // Feature flag not set (or false)
        httpContext.set(HTTP_CONTEXT_KEYS.COMPOSITION_SENSITIVE_SECTION_FILTERING, false);

        const input = deepcopy(compositionWithSensitiveSections);
        const result = FhirResourceSerializer.serialize(input);

        // All 4 sections remain including the sensitive ones
        expect(result.section).toHaveLength(4);
    });

    test('should NOT strip sensitive sections when httpContext has no flag', async () => {
        await createTestRequest();

        // httpContext has nothing set — default behavior is no filtering
        const input = deepcopy(compositionWithSensitiveSections);
        const result = FhirResourceSerializer.serialize(input);

        expect(result.section).toHaveLength(4);
    });
});
```

- [ ] **Step 2: Run the integration test**

Run: `nvm use && node node_modules/.bin/jest src/tests/serializer/compositionSectionFilter/compositionSectionFilterIntegration.test.js --no-coverage`
Expected: PASS — all 3 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/tests/serializer/compositionSectionFilter/compositionSectionFilterIntegration.test.js
git commit -m "test: add integration tests for composition sensitive section filtering"
```

---

### Task 6: Run full test suite and verify no regressions

**Files:** None — verification only

- [ ] **Step 1: Run the existing Composition serializer test**

Run: `nvm use && node node_modules/.bin/jest src/tests/serializer/bundle/testCompositionSerializer.test.js --no-coverage`
Expected: PASS — existing tests should pass because the feature flag is not set in httpContext (defaults to no filtering)

- [ ] **Step 2: Run all new tests together**

Run: `nvm use && node node_modules/.bin/jest src/tests/serializer/compositionSectionFilter/ --no-coverage`
Expected: PASS — all unit + integration tests pass

- [ ] **Step 3: Run full lint check**

Run: `npm run lint`
Expected: No new lint errors

- [ ] **Step 4: Final commit with all files**

Verify `git status` shows only the expected files are staged/modified. If any files were missed in earlier commits, add them now.
