import React, {useState} from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

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

const SearchContainer = () => {
    const [value, setValue] = useState(0);

    const handleChange = (event, newValue) => {
        setValue(newValue);
    };

    return (
        <>
            <Tabs value={value} onChange={handleChange}>
                <Tab label="Tab One"/>
                <Tab label="Tab Two"/>
                <Tab label="Tab Three"/>
            </Tabs>
            <TabPanel value={value} index={0}>
                Content of Tab One
            </TabPanel>
            <TabPanel value={value} index={1}>
                Content of Tab Two
            </TabPanel>
            <TabPanel value={value} index={2}>
                Content of Tab Three
            </TabPanel>
        </>
    );
};

export default SearchContainer;
