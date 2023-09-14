import React from 'react';
import {Box} from '@mui/material';
import Code from '../partials/Code';
import Coding from '../partials/Coding';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import NameValue from '../partials/NameValue';
import Uri from '../partials/Uri';

const Endpoint = ({resource}) => {
    return (
        <Box>
            <NameValue value={resource.name} name="Name" />
            <Uri value={resource.address} name="URL" />
            <Code value={resource.status} name="Status" />
            <Reference references={resource.managingOrganization} name="Managing Organization" />
            <Coding resourceType={resource.resourceType} codings={resource.connectionType} name="Connection Type" searchParameter="type" />
            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.payloadType} name="Payload" searchParameter="" />
        </Box>
    );
}

export default Endpoint;

