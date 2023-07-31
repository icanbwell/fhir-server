import React from 'react';
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper} from '@mui/material';
import {Link} from 'react-router-dom';

function HumanNames({names, resourceType}) {
    if (!Array.isArray(names)) {
        names = [names];
    }

    if (!names || names.length === 0 || !names[0]) {
        return null;
    }

    return (
        <div>
            <h4>Names</h4>
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Id</TableCell>
                            <TableCell>Use</TableCell>
                            <TableCell>Family</TableCell>
                            <TableCell>Given</TableCell>
                            <TableCell>Text</TableCell>
                            <TableCell>Period Start</TableCell>
                            <TableCell>Period End</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {names.map((name, i) => name && (
                            <TableRow key={i}>
                                <TableCell>{name.id}</TableCell>
                                <TableCell>{name.use}</TableCell>
                                <TableCell>
                                    <Link to={`/4_0_0/${resourceType}?family=${name.family}`}
                                          title={`Search for ${name.family}`}>
                                        {name.family}
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    {name.given && name.given.map((given, j) => (
                                        <Link key={j} to={`/4_0_0/${resourceType}?given=${given}`}
                                              title={`Search for ${given}`}>
                                            {given}
                                        </Link>
                                    ))}
                                </TableCell>
                                <TableCell>{name.text}</TableCell>
                                <TableCell>{name.period && name.period.start}</TableCell>
                                <TableCell>{name.period && name.period.end}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </div>
    );
}

export default HumanNames;
