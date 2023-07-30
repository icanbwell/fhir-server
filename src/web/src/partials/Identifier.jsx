import React from 'react';
import {makeStyles} from '@mui/styles';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';

const useStyles = makeStyles({
    table: {
        minWidth: 650,
    },
});

function Identifier({identifiers, resourceType}) {
    const classes = useStyles();

    return (
        <TableContainer component={Paper}>
            <Table className={classes.table} aria-label="identifier table">
                <TableHead>
                    <TableRow>
                        <TableCell>Id</TableCell>
                        <TableCell>Value</TableCell>
                        <TableCell>System</TableCell>
                        <TableCell>Type Code</TableCell>
                        <TableCell>Type System</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {identifiers.map(identifier => {
                        if (identifier) {
                            return (
                                <TableRow key={identifier.id}>
                                    <TableCell>{identifier.id}</TableCell>
                                    <TableCell>
                                        <a title={`Search for ${identifier.value}`}
                                           href={`/4_0_0/${resourceType}?identifier=${identifier.system}|${identifier.value}`}>{identifier.value}</a>
                                    </TableCell>
                                    <TableCell>{identifier.system}</TableCell>
                                    <TableCell>
                                        {identifier.type && identifier.type.coding &&
                                            identifier.type.coding.map(coding => <span
                                                key={coding.code}>{coding.code} &nbsp;</span>)
                                        }
                                    </TableCell>
                                    <TableCell>
                                        {identifier.type && identifier.type.coding &&
                                            identifier.type.coding.map(coding => <span
                                                key={coding.system}>{coding.system} &nbsp;</span>)
                                        }
                                    </TableCell>
                                </TableRow>
                            );
                        }
                        return null;
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

export default Identifier;
