import React from 'react';
import {Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';

/**
 * Extension
 * @param extensions
 * @return {React.JSX.Element|null}
 * @constructor
 */
function Extension({extensions}) {
    if (!extensions) {
        return null;
    }
    // Ensure `extensions` is an array
    if (!Array.isArray(extensions)) {
        extensions = [extensions];
    }

    return (
        extensions && extensions.length > 0 && extensions[0] ? (
            <Box>
                <Typography variant="h4">Extension</Typography>
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Id</TableCell>
                                <TableCell>Url</TableCell>
                                <TableCell>Detail Url</TableCell>
                                <TableCell>Value</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {extensions.map((extension) => {
                                if (extension && extension.extension) {
                                    return extension.extension.filter(e => e).map((detailExtension) => {
                                        return (
                                            <TableRow key={detailExtension.id}>
                                                <TableCell>{extension.id}</TableCell>
                                                <TableCell>{extension.url}</TableCell>
                                                <TableCell>{detailExtension.url}</TableCell>
                                                <TableCell>
                                                    {detailExtension.valueCodeableConcept ?
                                                        `${detailExtension.valueCodeableConcept.coding[0].code} (${detailExtension.valueCodeableConcept.text})`
                                                        : detailExtension.valueRange ?
                                                            `${detailExtension.valueRange.low.value} ${detailExtension.valueRange.low.unit} to ${detailExtension.valueRange.high.value} ${detailExtension.valueRange.high.unit}`
                                                            : `${detailExtension.valueString}${detailExtension.valueUri}`
                                                    }
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                } else if (extension) {
                                    return (
                                        <TableRow key={extension.id}>
                                            <TableCell>{extension.id}</TableCell>
                                            <TableCell>{extension.url}</TableCell>
                                            <TableCell></TableCell>
                                            <TableCell>
                                                {extension.valueCodeableConcept ?
                                                    `${extension.valueCodeableConcept.coding[0].code} (${extension.valueCodeableConcept.text})`
                                                    : `${extension.valueString}${extension.valueUri}`
                                                }
                                            </TableCell>
                                        </TableRow>
                                    )
                                } else {
                                    return <span></span>;
                                }
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        ) : null
    );
}

export default Extension;
