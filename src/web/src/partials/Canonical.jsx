import React from 'react';
import { Typography, Link } from '@mui/material';

const Canonical = ({name, value}) => {
    return (
        value && (
            <div>
                <Typography variant="body1" component="b">{`${name}:`}&nbsp</Typography>
                <Link href={value}>{value}</Link>
            </div>
        )
    );
};

export default Canonical;
