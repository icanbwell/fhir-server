import React from 'react';
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Box} from '@mui/material';

const Period = ({ periods, name }) => {
  // Ensure periods is always an array
  if (!Array.isArray(periods)) {
    periods = [periods];
  }

  if (periods && periods.length > 0 && periods[0]) {
    return (
      <Box>
        <Typography variant="h4">{name}</Typography>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Start</TableCell>
                <TableCell>End</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {periods.map((period, index) => period && (
                <TableRow key={index}>
                  <TableCell>{period.start}</TableCell>
                  <TableCell>{period.end}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }

  // In case there are no periods, we return null, not to render anything
  return null;
};

export default Period;
