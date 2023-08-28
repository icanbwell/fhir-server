import React from 'react';
import {Typography, Link, Box} from '@mui/material';

const Canonical = ({name, value}) => {
    return (
        value && (
            <Box>
                <Typography variant="body1" component="b">{`${name}:`}&nbsp</Typography>
                <Link href={value}>{value}</Link>
            </Box>
        )
    );
};

export default Canonical;
