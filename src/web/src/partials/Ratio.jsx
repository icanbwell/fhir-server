import React from 'react';
import Typography from '@mui/material/Typography';
import {Box} from '@mui/material';

function Ratio({ ratio, name }) {
    if (ratio && ratio.numerator) {
        return (
            <Box>
                <Typography variant="h5">{`${name}:`}</Typography>
                <Typography>{`${ratio.numerator.value} ${ratio.numerator.unit || ""} of ${ratio.denominator && ratio.denominator.value} ${(ratio.denominator && ratio.denominator.unit) || ""}`}</Typography>
            </Box>
        );
    } else {
        return null;
    }
}

export default Ratio;
