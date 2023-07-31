import React, { useState } from 'react';
import { Button, TextField, InputAdornment, FormControl, InputLabel, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const SearchForm = ({ url, resourceDefinition, advSearchFormData, lastUpdateStart, lastUpdateEnd, formData, body, limit }) => {
    const hasResource = resourceDefinition !== undefined;
    const resourceName = hasResource ? resourceDefinition.name : '';

    return (
        url && url.includes('/_search') ?
            <form action={`/4_0_0/${resourceName}/_search`} id="searchForm" method="post">
                {/* ... More code ... */}
                {advSearchFormData.map((data, i) => (
                    <div className="row mb-2 flex-nowrap" key={i}>
                        <TextField
                            label={data.label}
                            id={data.name}
                            name={`${data.name}${!data.useExactMatch ? ':contains' : ''}`}
                            value={data.value}
                            autoComplete="nope"
                            InputProps={{
                                endAdornment:
                                <InputAdornment position="end">
                                    <IconButton>
                                        <CloseIcon />
                                    </IconButton>
                                </InputAdornment>
                            }}
                        />
                    </div>
                ))}
                {/* ... More code ... */}
                {formData.map((data, j) => (
                    data.name === 'date' ?
                    <div className="form-group" key={j}>
                        <TextField
                            label={data.label}
                            id="datePicker"
                            name={data.name}
                            value={data.value}
                            autoComplete="off"
                            placeholder="YYYY-MM-DD"
                        />
                    </div> :
                    <div className="form-group form-group-clear" key={j}>
                        <TextField
                            label={data.label}
                            id={data.name}
                            name={`${data.name}${!data.useExactMatch ? ':contains' : ''}`}
                            value={data.value}
                            placeholder={data.label}
                            autoComplete="off"
                            InputProps={{
                                endAdornment:
                                <InputAdornment position="end">
                                    <IconButton>
                                        <CloseIcon />
                                    </IconButton>
                                </InputAdornment>
                            }}
                        />
                    </div>
                ))}
                {/* ... More code ... */}
                <Button type="button" id="resetFormButton">Reset</Button>
                <Button type="submit">
                    <i className="fa fa-search"></i>
                    Search
                </Button>
                {/* ... More code ... */}
            </form> : null
    );
};

export default SearchForm;
