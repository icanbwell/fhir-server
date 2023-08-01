import React from 'react';
import Typography from '@mui/material/Typography';
import CodeableConcept from '../partials/CodeableConcept';
import Address from '../partials/Address';
import ContactPoint from '../partials/ContactPoint';
import ReverseReference from '../partials/ReverseReference';

function Organization({resource}) {
    return (
        <>
            <Typography variant="h6">Active</Typography>
            <Typography variant="body1">{resource.active}</Typography>

            <Typography variant="h6">Name</Typography>
            <Typography variant="body1">{resource.name}</Typography>

            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={resource.type}
                name="Type"
                searchParameter='type'
            />

            <Address
                resourceType={resource.resourceType}
                addresses={resource.address}
                name="Address"
            />

            <ContactPoint
                resourceType={resource.resourceType}
                contacts={resource.telecom}
                name="Telecom"
            />

            <ReverseReference
                reverseReferences={[{target: 'PractitionerRole', property: 'organization'}]}
                id={resource.id}
                name="Practitioner Role"
            />

            <ReverseReference
                reverseReferences={[{target: 'HealthcareService', property: 'organization'}]}
                id={resource.id}
                name="Healthcare Service"
            />

            <ReverseReference
                reverseReferences={[{target: 'Location', property: 'organization'}]}
                id={resource.id}
                name="Location"
            />
        </>
    );
}

export default Organization;
