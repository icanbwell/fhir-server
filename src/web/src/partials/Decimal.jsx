import React from 'react';
import {Typography} from '@mui/material';

const DateTime = ({name, value}) => {
    if (!value) return null;

    return (
        <Typography component="div">
            <b>{name}:</b>&nbsp;{value}
        </Typography>
    );
};

export default DateTime;
