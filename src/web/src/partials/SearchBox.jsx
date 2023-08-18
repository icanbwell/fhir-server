import React, {useState} from 'react';
import SearchIcon from '@mui/icons-material/Search';
import InputBase from '@mui/material/InputBase';
import {alpha, styled} from '@mui/material/styles';

const Search = styled('div')(({theme}) => ({
    position: 'relative',
    borderRadius: theme.shape.borderRadius,
    backgroundColor: alpha(theme.palette.common.white, 0.15),
    '&:hover': {
        backgroundColor: alpha(theme.palette.common.white, 0.25),
    },
    marginRight: theme.spacing(2),
    marginLeft: 0,
    width: '100%',
    [theme.breakpoints.up('sm')]: {
        marginLeft: theme.spacing(3),
        width: 'auto',
    },
}));

const SearchIconWrapper = styled('div')(({theme}) => ({
    padding: theme.spacing(0, 2),
    height: '100%',
    position: 'absolute',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
}));

const StyledInputBase = styled(InputBase)(() => ({
    color: 'inherit',
    '& .MuiInputBase-input': {
        padding: '8px 8px 8px 0px',
        paddingLeft: `calc(1em + 25px)`,
        width: '100%',
    },
}));

const SearchBox = () => {
    const [search, setSearch] = useState('');

    const handleSearchChange = (event) => {
        setSearch(event.target.value);
    };

    return (
        <Search>
            <SearchIconWrapper>
                <SearchIcon/>
            </SearchIconWrapper>
            <StyledInputBase
                placeholder="Search…"
                inputProps={{'aria-label': 'search'}}
                value={search}
                onChange={handleSearchChange}
            />
        </Search>
    );
};

export default SearchBox;
