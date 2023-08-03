import React from 'react';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

const Instant = ({name, value}) => {
    return (
        value ? (
            <Box>
                <Typography variant="body1">
                    <b>{name}:</b>&nbsp;{value}
                </Typography>
            </Box>
        ) : null
    )
};

export default Instant;
