# FHIR $graph endpoint

The FHIR server supports the $graph endpoint of FHIR specification (https://www.hl7.org/fhir/R4B/resource-operation-graph.html).

The $graph endpoint accepts a GraphDefinition resource: https://www.hl7.org/fhir/R4B/graphdefinition.html.

The $graph endpoint creates a graph per the passed in GraphDefinition and returns the whole graph in one call.

Note: Make sure you set `Content-Type: application/fhir+json` in the HTTP call.

### Examples

Here are the examples graphs that $everything uses underneath: https://github.com/icanbwell/fhir-server/tree/main/src/graphs

### Implementation

here's the $graph implementation: https://github.com/icanbwell/fhir-server/blob/16990bd500d316300ef36d1a305cd8d255e42935/src/services/base/base.service.js#L2305

and unit test for it: https://github.com/icanbwell/fhir-server/tree/main/src/tests/organization/graph

#### GraphDefinition

The documentation for GraphDefinition(https://www.hl7.org/fhir/R4B/graphdefinition.html) on the FHIR website is not very good so here’s more detail:

Take an example GraphDefinition below.

```json
{
    "resourceType": "GraphDefinition",
    "id": "o",
    "name": "organization_everything",
    "status": "active",
    "start": "Organization",
    "link": [
        {
            "target": [
                {
                    "type": "Location",
                    "params": "managingOrganization={ref}"
                }
            ]
        },
        {
            "target": [
                {
                    "type": "HealthcareService",
                    "params": "providedBy={ref}"
                }
            ]
        },
        {
            "target": [
                {
                    "type": "OrganizationAffiliation",
                    "params": "participatingOrganization={ref}"
                }
            ]
        }
    ]
}
```

`"start": "Organization"` means which resource we should start from which is the parent resource for any related resources..

`link` means related resources (link can be nested as explained below)

In this example, we’re requested 3 linked resources to Organization.

```json
{
    "target": [
        {
            "type": "Location",
            "params": "managingOrganization={ref}"
        }
    ]
}
```

This means the linked resource is a `Location`. The linkage is that the `managingOrganization` reference of the `Location` resource should point to the parent `Organization` resource.

```json
{
    "target": [
        {
            "type": "HealthcareService",
            "params": "providedBy={ref}"
        }
    ]
}
```

This means the linked resource is a `HealthcareService`. The linkage is that the `providedBy` reference of the `HealthcareService` should point to the parent `Organization` resource.

The above are all examples of reverse linkage where the parent resource, `Organization`, does not have a reference to the linked resource but the linked resource has a reference back to the parent resource.

The other type of linkage is forward reference where the parent resource has a reference to linked resource. This is an example of forward reference:

```json
{
    "path": "organization",
    "target": [
        {
            "type": "Organization"
        }
    ]
}
```

This means the `organization` property in the parent resource is a reference to a resource of type `Organization`.

Linked resources can be nested. For example, this graph has nested linked resources.

```json
{
    "resourceType": "GraphDefinition",
    "id": "o",
    "name": "provider_everything",
    "status": "active",
    "start": "Practitioner",
    "link": [
        {
            "description": "Practitioner Roles for this Practitioner",
            "target": [
                {
                    "type": "PractitionerRole",
                    "params": "practitioner={ref}",
                    "link": [
                        {
                            "path": "organization",
                            "target": [
                                {
                                    "type": "Organization"
                                }
                            ]
                        },
                        {
                            "path": "location[x]",
                            "target": [
                                {
                                    "type": "Location",
                                    "params": "_security=https://www.icanbwell.com/access|abc"
                                }
                            ]
                        },
                        {
                            "path": "healthcareService[x]",
                            "target": [
                                {
                                    "type": "HealthcareService"
                                }
                            ]
                        },
                        {
                            "path": "extension.extension:url=plan",
                            "target": [
                                {
                                    "link": [
                                        {
                                            "path": "valueReference",
                                            "target": [
                                                {
                                                    "type": "InsurancePlan"
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
}
```

`[x]` means this property is a list not a single.

### Filtering

There are two different filters and they do different things: `link.path` chooses which nested
elements of the *parent* to follow, and `target.params` filters the resources that get *fetched*.

#### Filtering which nested elements to follow (`link.path`)

```json
{
    "path": "extension.extension:url=plan"
}
```

This means return extensions where url property is equal to “plan”.

The `:property=value` suffix is matched against the raw JSON properties of the elements at that
path. It is not a FHIR search query.

On a path that resolves to a reference (for example `subject`), the suffix is additionally applied
as a field name on the fetched resource, on top of the reference relationship. Because the property
being named belongs to the *parent's* element rather than to the target resource, this almost always
matches nothing and the link comes back empty — `subject:meta.security=tenantA` returns no resources
even for the caller's own tenant, because `meta.security` holds an array of Coding objects rather
than a string. Names that are not shaped like a field path (anything starting with `$` or `_`, for
instance) are dropped instead of applied. To filter the resources at the far end of a reference, use
`target.params`.

#### Filtering the resources that get fetched (`target.params`)

For reverse link params, you can use standard query parameters:
```json
{
  "target": [
    {
      "type": "Person",
      "params": "patient={ref}&_security:not=https://www.icanbwell.com/owner|bwell"
    }
  ]
},
```

Filtering in forward reference linkage can also be done as in this example:
```json
{
    "path": "location[x]",
    "target": [
        {
            "type": "Location",
            "params": "_security=https://www.icanbwell.com/access|abc"
        }
    ]
}
```
Here only those locations will be fetched whose reference is present at the given path and which also satisfy the query parameter.

`target.params` is parsed as a FHIR search query against the target resource type, so any search
parameter that resource type supports works — `_security`, `_tag`, `_profile`, `_lastUpdated`,
`_source`, and the resource’s own parameters.

Two things to know about it:

- A name that is not a search parameter for that resource type is **ignored**, and the link behaves
  as if the filter were absent. In particular `meta.security` is a stored field path, not a search
  parameter — the search parameter for security tags is `_security`.
- It can only ever **narrow** the result. It is combined with the reference relationship and with
  the caller’s own access filter, and cannot replace either. A caller passing a `_security` value
  for a tenant it is not authorized for gets nothing back, not that tenant’s data.
- On a reverse link, **the parameter carrying the `{ref}` or `{id}` placeholder must be listed
  first**. The first parameter in the string is the one used to match children back to the parent,
  so `status=final&subject={ref}` matches nothing at all, while `subject={ref}&status=final` works
  as intended. Additional parameters after the first are applied as ordinary filters.

### Proxy patient ids

A clinical resource may reference a Person instead of a Patient by using a proxy-patient
reference of the form `Patient/person.<person uuid>`.

`$graph` expands proxy-patient references **only for the resource named in the request URL**, and
that expansion applies **only to reverse links**. This is intentional, and the two halves of the
rule are worth stating separately:

- **The request URL is expanded.** Starting a graph at `Patient/person.<uuid>` (or at
  `Person/<uuid>`) makes reverse links match children that reference the proxy patient *as well as*
  children that reference the underlying Patient directly. Starting the same graph at the real
  Patient id matches only the children that reference that Patient directly — the proxy is not
  consulted, because it was not what the caller asked for.
- **References found during traversal are not expanded.** A proxy-patient reference reached by
  following a forward `link.path` — for example `Observation.subject` holding
  `Patient/person.<uuid>` — is resolved literally. Since no Patient exists with the id
  `person.<uuid>`, that link contributes no resource to the bundle. It does not fall back to the
  Person, nor to the Patients that Person links to.

The consequence to design around: `$graph` will not silently widen a traversal from one patient to
every patient sharing a Person. If you need the resources of every Patient behind a Person, start
the graph at the Person or at its proxy patient id, rather than expecting a forward link to a proxy
reference to fan out.

### Contained query parameter

By default, the FHIR returns all the related resources in the top level bundle.  
However if you pass in the `contained` query parameter then the FHIR server will put the related resources in a `contained` field under each resource.

For example: https://fhir.icanbwell.com/4_0_0/Organization/$graph?id=733797173,1234&contained=true

FHIR Specification: https://www.hl7.org/fhir/R4B/references.html#contained
