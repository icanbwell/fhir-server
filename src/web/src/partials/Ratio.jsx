import React from 'react';
import Typography from '@mui/material/Typography';

function Ratio({ ratio, name }) {
    if (ratio && ratio.numerator) {
        return (
            <div>
                <Typography variant="h5">{`${name}:`}</Typography>
                <Typography>{`${ratio.numerator.value} ${ratio.numerator.unit || ""} of ${ratio.denominator && ratio.denominator.value} ${(ratio.denominator && ratio.denominator.unit) || ""}`}</Typography>
            </div>
        );
    } else {
        return null;
    }
}

export default Ratio;
