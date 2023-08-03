import React from 'react';
import {Typography} from '@mui/material';

const Decimal = ({name, value}) => {
    if (!value) return null;

    return (
        <Typography component="div">
            <b>{name}:</b>&nbsp;{value}
        </Typography>
    );
};

export default Decimal;
