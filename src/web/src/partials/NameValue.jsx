import React from 'react';
import { Typography, Box } from '@mui/material';

const NameValue = ({ name, value }) => {
  // Return null if value is not defined
  if (value === undefined) {
    return null;
  }

  return (
    <Box>
      <Typography variant="body1" component="div">
        <b>{name}:</b>&nbsp;{value}
      </Typography>
    </Box>
  );
};

export default NameValue;
