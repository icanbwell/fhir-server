// Import React and Material UI components
import React from 'react';
import {Box, Typography} from '@mui/material';

// The Reference component
const OrganizationAffiliation = ({references, name}) => (
    <Box>
        <Typography variant="body1">{name}</Typography>
        {references.map((ref, index) => (
            <Typography key={index} variant="body2">
                {ref}
            </Typography>
        ))}
    </Box>
);

export default OrganizationAffiliation;
