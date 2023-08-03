import React from 'react';
import {Typography, Box} from '@mui/material';

const Markdown = ({name, value}) => {
    if (value !== undefined) {
        return (
            <Box>
                <Typography variant="body1" component="div"><b>{name}:</b>&nbsp;{value}</Typography>
            </Box>
        )
    }
    return null;
};

export default Markdown;
