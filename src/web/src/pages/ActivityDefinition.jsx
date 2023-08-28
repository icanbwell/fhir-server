import React from 'react';
import {Box} from '@mui/material';
import NameValue from '../partials/NameValue';
import DateTime from '../partials/DateTime';
import Uri from '../partials/Uri';

const ActivityDefinition = ({resource, admin, index}) => {

    return (
        <Box>
            <NameValue value={resource.url} name="URL"/>
            <NameValue value={resource.name} name="Name"/>
            <NameValue value={resource.description} name="Description"/>
            <DateTime value={resource.approvalDate} name="Approval Date"/>
            <Uri value={resource.library} name="Library"/>
        </Box>
    );
};

export default ActivityDefinition;
