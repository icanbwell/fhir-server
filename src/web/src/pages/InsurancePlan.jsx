import React from 'react';
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from '@mui/material';

function InsurancePlan({resource}) {
    return (
        <div>
            <Typography variant="h4">Name</Typography>
            <Typography variant="body1">{resource.name}</Typography>

            {/* Include the reference component here, assuming it's converted to React */}
            {/* <Reference references={resource.ownedBy} name="Owned By" /> */}

            {resource.plan && (
                <TableContainer>
                    <Table sx={{minWidth: 650}} aria-label="simple table">
                        <TableHead>
                            <TableRow>
                                <TableCell>Type</TableCell>
                                <TableCell>Value</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {resource.plan.map((plan) =>
                                plan.identifier ? (
                                    plan.identifier.map((identifier) => (
                                        <TableRow key={identifier.value}>
                                            <TableCell>
                                                {identifier.type && identifier.type.coding
                                                    ? identifier.type.coding.map((coding) => (
                                                        <React.Fragment key={coding.code}>
                                                            {`${coding.code} (${coding.display})`}
                                                        </React.Fragment>
                                                    ))
                                                    : null}
                                            </TableCell>
                                            <TableCell>{identifier.value}</TableCell>
                                        </TableRow>
                                    ))
                                ) : null
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </div>
    );
}

export default InsurancePlan;
