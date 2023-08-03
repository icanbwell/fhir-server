import React from 'react';
import {Typography, Link, Box} from '@mui/material';

function Uri({name, value}) {
    return (
        value &&
        <Box>
            <Typography variant="body1" display="inline">
                <b>{name}:</b>&nbsp
            </Typography>
            <Link href={value}>
                {value}
            </Link>
        </Box>
    );
}

export default Uri;
