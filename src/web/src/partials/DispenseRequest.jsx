import React from "react";
import {Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Box} from "@mui/material";

const DispenseRequest = ({name, value}) => {

    if (!Array.isArray(value)) {
        value = [value];
    }

    return (
        <Box>
            {value && value.length > 0 && value[0] && (
                <React.Fragment>
                    <Typography variant="h4">{name}</Typography>
                    {value.map((dispenseRequest, index) => (
                        <div key={index}>
                            {dispenseRequest.initialFill && (
                                <React.Fragment>
                                    <Typography variant="h5">Initial Fill</Typography>
                                    <Typography variant="body1">
                                        Quantity: {dispenseRequest.initialFill.quantity}
                                    </Typography>
                                    <Typography variant="body1">
                                        Duration: {dispenseRequest.initialFill.duration}
                                    </Typography>
                                </React.Fragment>
                            )}
                            <TableContainer>
                                <Table className="table">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>dispenseInterval</TableCell>
                                            <TableCell>validityPeriod start</TableCell>
                                            <TableCell>validityPeriod end</TableCell>
                                            <TableCell>numberOfRepeatsAllowed</TableCell>
                                            <TableCell>quantity</TableCell>
                                            <TableCell>quantity Unit</TableCell>
                                            <TableCell>expectedSupplyDuration</TableCell>
                                            <TableCell>Performer</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        <TableRow>
                                            <TableCell>{dispenseRequest.dispenseInterval}</TableCell>
                                            <TableCell>{dispenseRequest.validityPeriod?.start}</TableCell>
                                            <TableCell>{dispenseRequest.validityPeriod?.end}</TableCell>
                                            <TableCell>{dispenseRequest.numberOfRepeatsAllowed}</TableCell>
                                            <TableCell>{dispenseRequest.quantity?.value }</TableCell>
                                            <TableCell>{dispenseRequest.quantity?.unit}</TableCell>
                                            <TableCell>{dispenseRequest.expectedSupplyDuration?.value}</TableCell>
                                            <TableCell>{dispenseRequest.performer?.reference}</TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </div>
                    ))}
                </React.Fragment>
            )}
        </Box>
    );
};

export default DispenseRequest;
