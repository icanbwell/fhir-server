import React from 'react';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

const Boolean = ({name, value}) => {
    if (value !== undefined) {
        return (
            <Box>
                <Typography variant="body1">
                    <b>{name}:</b>&nbsp;{value ? 'True' : 'False'}
                </Typography>
            </Box>
        );
    } else {
        return null;
    }
};

export default Boolean;
