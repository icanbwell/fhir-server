import React from 'react';
import {Typography, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from '@mui/material';
import Code from '../partials/Code';
import NameValue from '../partials/NameValue';
import Uri from '../partials/Uri';
import Reference from '../partials/Reference';
import Period from '../partials/Period';

const MeasureReport = ({resource}) => {
    return (
        <Box>
            <Code value={resource.status} name="Status"/>
            <NameValue value={resource.type} name="Type"/>
            <Uri value={resource.measure} name="Measure"/>
            <Reference references={resource.subject} name="Subject"/>
            <Period periods={[resource.period]} name="Period"/>

            {resource.group && (
                <Box>
                    <Typography variant="h4">Group</Typography>
                    <TableContainer>
                        <Table aria-label="simple table">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Population</TableCell>
                                    <TableCell>Measure Score</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {resource.group.map((group) => (
                                    <TableRow key={group.id}>
                                        <TableCell>
                                            {group.population &&
                                                group.population.map((population) =>
                                                    population.code && population.code.coding
                                                        ? population.code.coding.map((coding) => (
                                                            <Box key={coding.id}>
                                                                {coding.code} = {population.count}
                                                            </Box>
                                                        ))
                                                        : null
                                                )}
                                        </TableCell>
                                        <TableCell>
                                            {group.measureScore && <Box>{group.measureScore.value}</Box>}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            )}
        </Box>
    );
};

export default MeasureReport;
