import React from 'react';
import {Box} from '@mui/material';
import Uri from '../partials/Uri';
import NameValue from '../partials/NameValue';
import Code from '../partials/Code';
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import DateTime from '../partials/DateTime';
import Attachment from '../partials/Attachment';

const Library = ({resource}) => {
    return (
        <Box>
            <Uri value={resource.url} name="URL"/>
            <NameValue value={resource.version} name="Version"/>
            <NameValue value={resource.name} name="Name"/>
            <NameValue value={resource.title} name="Title"/>

            <Code value={resource.status} name="Status"/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.type} name="Type"
                             searchParameter=""/>

            <CodeableConcept resourceType={resource.resourceType} codeableConcepts={resource.subjectCodeableConcept}
                             name="Subject" searchParameter=""/>
            <Reference references={resource.subjectReference} name="Subject"/>

            <DateTime value={resource.date} name="Date"/>

            <Attachment value={resource.content}/>
        </Box>
    );
};

export default Library;
