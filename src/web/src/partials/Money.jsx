import React from 'react';
import { Typography, Box } from '@mui/material';

const Money = ({ name, value }) => {
  // Return null if value is not defined
  if (value === undefined) {
    return null;
  }
  if (name === undefined || name.length === 0) {
    return (
    <Box>
      <Typography variant="body1" component="div">
        ${value}
      </Typography>
    </Box>
    );
  } else {
  return (
    <Box>
      <Typography variant="body1" component="div">
        <b>{name}:</b>&nbsp;${value}
      </Typography>
    </Box>
    );
  }
};

export default Money;
