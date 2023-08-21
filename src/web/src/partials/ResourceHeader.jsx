import React from 'react';
import Narrative from '../partials/Narrative';
import Identifier from '../partials/Identifier';
import Meta from '../partials/Meta';
import Extension from '../partials/Extension';
import {Box, Link} from '@mui/material';

const styles = {
    answer: {
        color: 'rgb(30, 70, 32)',
        backgroundColor: 'rgb(237, 247, 237)'
    },
};

function ResourceHeader({resource}) {
    if (!resource) return null;
    return (
        <Box>
            <Link title="Direct link to Resource" href={`/4_0_0/${resource.resourceType}/${resource.id}`}>
                {resource.resourceType}/{resource.id}
            </Link>

            <Narrative name='Text' value={resource.text}/>
            <Identifier resourceType={resource.resourceType} identifiers={resource.identifier} name="Identifier"/>
            <Meta meta={resource.meta} name="Meta" resource={resource}/>
            <Extension extensions={resource.extension}/>
            <Extension extensions={resource.modifierExtension}/>
        </Box>
    );
}

export default ResourceHeader;
