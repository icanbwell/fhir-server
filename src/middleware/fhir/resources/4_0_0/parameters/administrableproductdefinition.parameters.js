module.exports = {
    device: {
        description:
            'A device that is integral to the medicinal product, in effect being considered as an "ingredient" of the medicinal product. This is not intended for devices that are just co-packaged',
        fhirtype: 'reference',
        type: 'reference',
        xpath: 'device'
    },
    'dose-form': {
        description:
            'The administrable dose form, i.e. the dose form of the final product after necessary reconstitution or processing',
        fhirtype: 'token',
        type: 'token',
        xpath: 'administrableDoseForm'
    },
    'form-of': {
        description:
            'The medicinal product that this is an administrable form of. This is not a reference to the item(s) that make up this administrable form - it is the whole product',
        fhirtype: 'reference',
        type: 'reference',
        xpath: 'formOf'
    },
    identifier: {
        description: 'An identifier for the administrable product',
        fhirtype: 'token',
        type: 'token',
        xpath: 'identifier'
    },
    ingredient: {
        description: 'The ingredients of this administrable medicinal product',
        fhirtype: 'token',
        type: 'token',
        xpath: 'ingredient'
    },
    'manufactured-item': {
        description:
            'The manufactured item(s) that this administrable product is produced from. Either a single item, or several that are mixed before administration (e.g. a power item and a solution item). Note that these are not raw ingredients',
        fhirtype: 'reference',
        type: 'reference',
        xpath: 'producedFrom'
    },
    route: {
        description: 'Coded expression for the route',
        fhirtype: 'token',
        type: 'token',
        xpath: 'routeOfAdministration.code'
    },
    'target-species': {
        description: 'Coded expression for the species',
        fhirtype: 'token',
        type: 'token'
    }
};
