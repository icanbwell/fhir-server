import React, {useEffect, useState} from 'react';
import {useLocation, useNavigate, useParams} from 'react-router-dom';
import {Accordion, Box, Container, LinearProgress} from '@mui/material';
import Header from '../partials/Header';
import Footer from '../partials/Footer';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Typography from '@mui/material/Typography';
import ResourceCard from './ResourceCard';
import FhirApi from '../utils/fhirApi';
import SearchContainer from '../partials/SearchContainer';

/**
 * IndexPage
 * Note: Any route parameters are available via useParams()
 * @returns {Element}
 * @constructor
 */
const IndexPage = ({search}) => {
    const [resources, setResources] = useState('');
    const [bundle, setBundle] = useState('');
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);

    const {id, resourceType, operation} = useParams();

    const [searchTabExpanded, setSearchTabExpanded] = useState(false);
    const [resourceCardExpanded, setResourceCardExpanded] = useState(false);

    const navigate = useNavigate();

    const handleExpand = () => {
        setSearchTabExpanded(!searchTabExpanded);
    };

    const location = useLocation();
    const queryString = location.search;

    function getBox() {
        if (loading) {
            return <LinearProgress/>;
        }
        if (parseInt(status) === 401) {
            return <Box>Login Expired</Box>;
        }
        if (parseInt(status) !== 200 && parseInt(status) !== 404) {
            return <Box>{status}</Box>;
        }
        if (resources.length === 0) {
            return <Box>No Results Found</Box>;
        }
        return <>
            {resources.map((fullResource, index) => {
                const resource = fullResource.resource || fullResource;
                return (
                    <ResourceCard key={index} index={index} resource={resource} expanded={resourceCardExpanded}/>
                );
            })}
        </>;
    }

    console.log(`id: ${id}, resourceType: ${resourceType}, queryString: ${queryString},` +
        ` search: ${search}, operation: ${operation}`);

    useEffect(() => {
        if (id) {
            setResourceCardExpanded(true);
        }
        const callApi = async () => {
            document.title = 'Helix FHIR Server';
            if (search) {
                setSearchTabExpanded(true);
                return;
            }
            try {
                setLoading(true);
                const fhirApi = new FhirApi();
                const {json, status} = await fhirApi.getBundleAsync(
                    {
                        resourceType,
                        id,
                        queryString,
                        operation,
                    }
                );
                if (status === 401) {
                    window.location.reload();
                }
                // noinspection JSCheckFunctionSignatures
                setStatus(status);
                if (json.entry) {
                    setResources(json.entry);
                    setBundle(json);
                    document.title = resourceType;
                } else {
                    // noinspection JSCheckFunctionSignatures
                    setResources(json ? [json] : []);
                    if (json.id) {
                        document.title = `${json.id} (${resourceType})`;
                    } else {
                        document.title = 'Helix FHIR Server';
                    }
                }
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        callApi().catch(console.error);
    }, [id, queryString, resourceType, search]);

    /**
     * Handle search event from child component
     * @param {SearchFormQuery} searchFormQuery
     */
    const handleSearch = (searchFormQuery) => {
        const fhirApi = new FhirApi();

        /**
         * @type {URL}
         */
        const newUrl = fhirApi.getUrl({
            resourceType: resourceType,
            id: id,
            queryParameters: searchFormQuery.getQueryParameters(),
        });
        const relativePath = newUrl.pathname + newUrl.search + newUrl.hash;
        console.info(`Navigating to ${relativePath}`);
        navigate(relativePath);
        // setSearchClicked(true);
        // setSearchTabExpanded(false);
    };

    return (
        <Container maxWidth={false}>
            <Header resources={resources}/>
            <Accordion expanded={searchTabExpanded} onChange={handleExpand}>
                <AccordionSummary
                    expandIcon={<ExpandMoreIcon/>}
                    aria-controls={`searchCollapse`}
                    id={`searchAccordion`}
                >
                    <Typography>Search</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <SearchContainer onSearch={handleSearch}></SearchContainer>
                </AccordionDetails>
            </Accordion>
            <Box my={2}>
                {getBox()}
            </Box>
            {bundle && <Footer url={bundle.url} meta={bundle.meta}/>}
        </Container>
    );
};

export default IndexPage;
