import React from 'react';
import {Box, Typography} from '@mui/material';

const Narrative = ({ value, name }) => {
    if (value !== undefined && value.div !== undefined) {
        return (
            <Box>
                <Typography variant="h4">{name}</Typography>&nbsp;
                <Box dangerouslySetInnerHTML={{ __html: value.div }} />
            </Box>
        );
    } else {
        return null;
    }
}

export default Narrative;
