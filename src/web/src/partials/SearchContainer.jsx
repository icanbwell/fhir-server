import React, {useState} from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import SearchForm from './SearchForm';
import SearchBox from './SearchBox';

function TabPanel(props) {
    const {children, value, index, ...other} = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`simple-tabpanel-${index}`}
            aria-labelledby={`simple-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box>
                    <Typography>{children}</Typography>
                </Box>
            )}
        </div>
    );
}

const SearchContainer = ({onSearch, resourceType}) => {
    const [value, setValue] = useState(0);

    const handleChange = (event, newValue) => {
        setValue(newValue);
    };

    const handleSearch = (searchFormQuery) => {
        onSearch(searchFormQuery);
    };

    return (
        <>
            <Tabs value={value} onChange={handleChange}>
                <Tab label="Advanced Search"/>
                <Tab label="ChatGPT Search"/>
                <Tab label="Tab Three"/>
            </Tabs>
            <TabPanel value={value} index={0}>
                <SearchForm onSearch={handleSearch}></SearchForm>
            </TabPanel>
            <TabPanel value={value} index={1}>
                <SearchBox onSearch={handleSearch}></SearchBox>
            </TabPanel>
            <TabPanel value={value} index={2}>
                Content of Tab Three
            </TabPanel>
        </>
    );
};

export default SearchContainer;
