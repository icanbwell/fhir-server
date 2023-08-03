import React from 'react';
import { Typography, Box } from '@mui/material';

const Time = ({ name, value }) => {
    if (value) {
        return (
            <Box>
                <Typography variant="body1" component="div">
                    <b>{name}:</b>&nbsp;{value}
                </Typography>
            </Box>
        );
    } else {
        return null;
    }
};

export default Time;
