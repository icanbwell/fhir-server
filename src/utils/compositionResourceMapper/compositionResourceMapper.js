const { SENSITIVE_CATEGORY } = require('../../constants');
const { generateUUIDv5 } = require('../uid.util');
const { DOMAIN_MAPPINGS } = require('./domainMappings');
const { unescapeHtml, escapeHtml, isPlaceholder } = require('./rowValues');

// Links a rebuilt resource to the source resources its section groups, for resource types that
// have no native derivedFrom field.
const SOURCE_RESOURCE_EXTENSION_URL =
    'https://fhir.icanbwell.com/4_0_0/StructureDefinition/composition-source-resource';

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * @typedef {Object} RowIssue
 * @property {string} resourceType
 * @property {string} title
 *
 * @typedef {Object} MappingReport Titles and types only, never row values.
 * @property {string[]} skippedCompositionTypes
 * @property {string[]} unmappedResourceTypes
 * @property {RowIssue[]} unknownRows
 * @property {RowIssue[]} unparsedRows
 * @property {{resourceType: string, field: string}[]} missingRequired
 */

/**
 * Collects issues once each, in the order they were first seen.
 */
class ReportBuilder {
    constructor() {
        this.lists = {
            skippedCompositionTypes: new Map(),
            unmappedResourceTypes: new Map(),
            unknownRows: new Map(),
            unparsedRows: new Map(),
            missingRequired: new Map()
        };
    }

    /**
     * @param {keyof MappingReport} list
     * @param {string|Object} item
     */
    add(list, item) {
        const key = typeof item === 'string' ? item : JSON.stringify(item);
        if (!this.lists[list].has(key)) {
            this.lists[list].set(key, item);
        }
    }

    /**
     * @param {MappingReport} report
     */
    merge(report) {
        for (const [list, items] of Object.entries(report)) {
            items.forEach((item) => this.add(list, item));
        }
    }

    /**
     * @returns {MappingReport}
     */
    build() {
        return Object.fromEntries(
            Object.entries(this.lists).map(([list, items]) => [list, [...items.values()]])
        );
    }
}

/**
 * A row is a leaf section that only carries a label and its display text.
 * @param {Object} section
 * @returns {boolean}
 */
function isRow(section) {
    return (
        typeof section?.text?.div === 'string' &&
        !(section.entry?.length > 0) &&
        !(section.section?.length > 0)
    );
}

/**
 * @param {Object} entry
 * @returns {string|undefined}
 */
function resourceTypeOfEntry(entry) {
    return entry.type ?? entry.reference.split('/').at(-2);
}

/**
 * Splits a section code into the clinical concept and the sensitivity codings the composition
 * service appends to it. Codings without a real code are dropped.
 * @param {Object|undefined} sectionCode
 * @returns {{concept: Object|undefined, sensitivityCodings: Object[]}}
 */
function splitSectionCode(sectionCode) {
    const codings = (sectionCode?.coding ?? []).filter((c) => c?.code && c.code !== 'null');
    const sensitivityCodings = codings.filter((c) => c.system === SENSITIVE_CATEGORY.SYSTEM);
    const clinicalCodings = codings.filter((c) => c.system !== SENSITIVE_CATEGORY.SYSTEM);

    const concept = {};
    if (clinicalCodings.length > 0) {
        concept.coding = structuredClone(clinicalCodings);
    }
    if (sectionCode?.text) {
        concept.text = sectionCode.text;
    }
    return {
        concept: Object.keys(concept).length > 0 ? concept : undefined,
        sensitivityCodings: structuredClone(sensitivityCodings)
    };
}

/**
 * @param {Object} resource
 * @param {string} field a field name, or a choice type written as `name[x]`
 * @returns {boolean}
 */
function hasField(resource, field) {
    if (field.endsWith('[x]')) {
        const prefix = field.slice(0, -3);
        return Object.keys(resource).some((key) => key.startsWith(prefix));
    }
    return resource[field] !== undefined;
}

/**
 * Rebuilds standalone FHIR resources from the summary Compositions the composition service
 * writes. Pure: it reads nothing but the Composition it is given.
 */
class CompositionResourceMapper {
    /**
     * @param {Object} [params]
     * @param {Object<string, Object<string, import('./domainMappings').ResourceSpec>>} [params.domainMappings]
     */
    constructor({ domainMappings = DOMAIN_MAPPINGS } = {}) {
        this.domainMappings = domainMappings;
    }

    /**
     * @param {Object} composition
     * @returns {{resources: Object[], report: MappingReport}}
     */
    mapComposition(composition) {
        const report = new ReportBuilder();
        const typeCodes = (composition?.type?.coding ?? []).map((c) => c.code);
        const typeCode = typeCodes.find((c) => this.domainMappings[c]);
        if (!typeCode) {
            report.add('skippedCompositionTypes', typeCodes[0] ?? 'unknown');
            return { resources: [], report: report.build() };
        }

        const context = {
            composition,
            domain: this.domainMappings[typeCode],
            report,
            // keyed by resource type and source references, so sections that describe the same
            // sources build one resource
            states: new Map()
        };
        this.walkSections(composition.section, context);

        const resources = [...context.states.values()].map((state) => this.finish(state, report));
        return { resources, report: report.build() };
    }

    /**
     * @param {Object[]} compositions
     * @returns {{bundle: Object, report: MappingReport}}
     */
    mapToBundle(compositions) {
        const report = new ReportBuilder();
        const entry = [];
        for (const composition of compositions) {
            const result = this.mapComposition(composition);
            report.merge(result.report);
            for (const resource of result.resources) {
                entry.push({ fullUrl: `urn:uuid:${resource.id}`, resource });
            }
        }
        return {
            bundle: { resourceType: 'Bundle', type: 'collection', entry },
            report: report.build()
        };
    }

    /**
     * @param {Object[]|undefined} sections
     * @param {Object} context
     */
    walkSections(sections, context) {
        for (const section of sections ?? []) {
            const entries = (section.entry ?? []).filter((e) => e?.reference);
            const children = section.section ?? [];
            if (entries.length > 0) {
                this.mapResourceSection({ section, entries, context });
            }
            this.walkSections(
                children.filter((child) => !isRow(child)),
                context
            );
        }
    }

    /**
     * @param {Object} params
     * @param {Object} params.section
     * @param {Object[]} params.entries
     * @param {Object} params.context
     */
    mapResourceSection({ section, entries, context }) {
        const resourceType = resourceTypeOfEntry(entries[0]);
        const spec = context.domain[resourceType];
        if (!spec) {
            context.report.add('unmappedResourceTypes', resourceType ?? 'unknown');
            return;
        }

        const references = entries.map((e) => e.reference);
        const key = `${resourceType}|${references.join(',')}`;
        let state = context.states.get(key);
        if (!state) {
            state = this.start({ resourceType, spec, references, section, context });
            context.states.set(key, state);
        }

        const { concept, sensitivityCodings } = splitSectionCode(section.code);
        if (concept) {
            spec.applyCode(state.resource, concept, context.composition);
        }
        this.addSecurity(state.resource, sensitivityCodings);
        if (spec.copySectionExtensions) {
            this.addExtensions(state.resource, section.extension);
        }
        for (const row of (section.section ?? []).filter(isRow)) {
            this.applyRow({ state, row, report: context.report });
        }
    }

    /**
     * @param {Object} params
     * @returns {{resource: Object, spec: Object, scratch: Object, narrative: Map<string, string>, fallbackTitle: string}}
     */
    start({ resourceType, spec, references, section, context }) {
        const { composition } = context;
        const resource = {
            resourceType,
            id: spec.idFromEntry
                ? references[0].split('/').at(-1)
                : generateUUIDv5(`${composition.id}|${resourceType}|${references.join(',')}`)
        };

        const meta = {};
        if (composition.meta?.source) {
            meta.source = composition.meta.source;
        }
        if (composition.meta?.security?.length > 0) {
            meta.security = structuredClone(composition.meta.security);
        }
        if (Object.keys(meta).length > 0) {
            resource.meta = meta;
        }
        if (composition.subject) {
            resource[spec.subjectField] = structuredClone(composition.subject);
        }

        if (spec.sourceField) {
            resource[spec.sourceField] = references.map((reference) => ({ reference }));
        } else if (!spec.idFromEntry) {
            resource.extension = references.map((reference) => ({
                url: SOURCE_RESOURCE_EXTENSION_URL,
                valueReference: { reference }
            }));
        }

        return {
            resource,
            spec,
            scratch: {},
            narrative: new Map(),
            fallbackTitle: section.title ?? resourceType
        };
    }

    /**
     * @param {Object} params
     * @param {Object} params.state
     * @param {Object} params.row
     * @param {ReportBuilder} params.report
     */
    applyRow({ state, row, report }) {
        const { resource, spec, scratch } = state;
        const title = row.title ?? '';
        const value = unescapeHtml(row.text.div).trim();
        state.narrative.set(`${title}|${value}`, { title, value });

        const setter = spec.rows[title];
        if (!setter) {
            report.add('unknownRows', { resourceType: resource.resourceType, title });
            return;
        }
        if (isPlaceholder(value)) {
            return;
        }
        if (setter(resource, value, scratch) === false) {
            report.add('unparsedRows', { resourceType: resource.resourceType, title });
        }
    }

    /**
     * @param {Object} resource
     * @param {Object[]} codings
     */
    addSecurity(resource, codings) {
        for (const coding of codings) {
            const security = resource.meta?.security ?? [];
            if (!security.some((s) => s.system === coding.system && s.code === coding.code)) {
                resource.meta = { ...resource.meta, security: [...security, coding] };
            }
        }
    }

    /**
     * @param {Object} resource
     * @param {Object[]|undefined} extensions
     */
    addExtensions(resource, extensions) {
        for (const extension of extensions ?? []) {
            const existing = resource.extension ?? [];
            const serialized = JSON.stringify(extension);
            if (!existing.some((e) => JSON.stringify(e) === serialized)) {
                resource.extension = [...existing, structuredClone(extension)];
            }
        }
    }

    /**
     * @param {Object} state
     * @param {ReportBuilder} report
     * @returns {Object}
     */
    finish(state, report) {
        const { resource, spec, scratch } = state;
        if (spec.finalize) {
            spec.finalize(resource, scratch);
        }
        resource.text = { status: 'generated', div: this.narrativeDiv(state) };
        for (const field of spec.required) {
            if (!hasField(resource, field)) {
                report.add('missingRequired', { resourceType: resource.resourceType, field });
            }
        }
        return resource;
    }

    /**
     * Every row, mapped or not, so nothing the composition says is lost.
     * @param {Object} state
     * @returns {string}
     */
    narrativeDiv({ narrative, fallbackTitle }) {
        if (narrative.size === 0) {
            return `<div xmlns="${XHTML_NAMESPACE}"><p>${escapeHtml(fallbackTitle)}</p></div>`;
        }
        const rows = [...narrative.values()]
            .map(
                ({ title, value }) =>
                    `<tr><th>${escapeHtml(title)}</th><td>${escapeHtml(value)}</td></tr>`
            )
            .join('');
        return `<div xmlns="${XHTML_NAMESPACE}"><table><tbody>${rows}</tbody></table></div>`;
    }
}

module.exports = {
    CompositionResourceMapper,
    SOURCE_RESOURCE_EXTENSION_URL
};
