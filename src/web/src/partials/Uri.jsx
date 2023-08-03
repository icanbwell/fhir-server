import React from 'react';
import { Typography, Link } from '@mui/material';

function Uri({name, value}) {
    return (
        value &&
        <div>
            <Typography variant="body1" display="inline">
                <b>{name}:</b>&nbsp
            </Typography>
            <Link href={value}>
                {value}
            </Link>
        </div>
    );
}

export default Uri;
