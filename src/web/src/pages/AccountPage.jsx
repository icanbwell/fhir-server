import React from 'react';
import {Link, Box} from '@mui/material';
import Reference from '../partials/Reference';

const Account = ({resource, admin, index}) => {

    return (
        <Box>
            <Reference references={resource.subject} name="Subject"/>
        </Box>
    );
};

export default Account;
