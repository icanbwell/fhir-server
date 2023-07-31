import React from 'react';
import { Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@mui/material';
import CodeableConcept from '../partials/CodeableConcept';

function Timing({ timing, name }) {
  // Convert timing to array if it's not
  const timingArray = Array.isArray(timing) ? timing : [timing];

  return (
    <>
      {timingArray && timingArray.length > 0 && timingArray[0] && (timingArray[0].count || timingArray[0].code) && (
        <div>
          <Typography variant="h4">{name}</Typography>
          {timingArray[0].count && (
            <TableContainer component={Paper}>
              <Table aria-label="simple table">
                <TableHead>
                  <TableRow>
                    <TableCell>Event</TableCell>
                    <TableCell>Count</TableCell>
                    <TableCell>Count Max</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {timingArray.map((t) => (
                    <TableRow key={t.count}>
                      <TableCell>
                        {t.event && t.event.join(", ")}
                      </TableCell>
                      <TableCell>{t.count}</TableCell>
                      <TableCell>{t.countMax}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {timingArray.map((t, index) => (
            <CodeableConcept key={index} resourceType="" codeableConcepts={t.code} name="Timing Code" searchParameter="" />
          ))}
        </div>
      )}
    </>
  );
}

export default Timing;
