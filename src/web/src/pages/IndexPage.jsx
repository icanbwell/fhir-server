import React, {useEffect, useState} from 'react';
import {useLocation, useParams} from 'react-router-dom';
import {Accordion, Box, Container} from '@mui/material';
import Header from '../partials/Header';
import Footer from '../partials/Footer';
import FhirApi from '../utils/fhirApi';
import SearchForm from '../partials/SearchForm';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Typography from '@mui/material/Typography';
import ResourceCard from './ResourceCard';

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
    const [loading, setLoading] = useState(true);
    const [searchClicked, setSearchClicked] = useState(false);
    const [queryParameters, setQueryParameters] = useState([]);

    const {id, resourceType} = useParams();

    const [searchTabExpanded, setSearchTabExpanded] = useState(false);
    const [resourceCardExpanded, setResourceCardExpanded] = useState(false);

    const handleExpand = () => {
        setSearchTabExpanded(!searchTabExpanded);
    };

    const location = useLocation();
    const queryString = location.search;

    console.log(`id: ${id}, resourceType: ${resourceType}, queryString: ${queryString},` +
        ` queryParameters: ${queryParameters}, search: ${search}`);

    useEffect(() => {
        if (id) {
            setResourceCardExpanded(true);
        }
        const callApi = async () => {
            document.title = 'Helix FHIR Server';
            if (search && !searchClicked) {
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
                        queryParameters
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
    }, [id, queryString, queryParameters, resourceType, search, searchClicked]);

    /**
     * Handle search event from child component
     * @param {SearchFormQuery} searchFormQuery
     */
    const handleSearch = (searchFormQuery) => {
        // You can handle the event and data here
        console.log("Child button clicked!", searchFormQuery);
        setQueryParameters(searchFormQuery.getQueryParameters());
        setSearchClicked(true);
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
                    <Typography>Advanced Search</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <SearchForm onSearch={handleSearch}></SearchForm>
                </AccordionDetails>
            </Accordion>
            <Box my={2}>
                {loading ? '' : status === 200 ? resources.map((fullResource, index) => {
                    const resource = fullResource.resource || fullResource;
                    return (
                        <ResourceCard key={index} index={index} resource={resource} expanded={resourceCardExpanded}/>
                    );
                }) : <div>Not Found</div>}
            </Box>
            {bundle && <Footer url={bundle.url} meta={bundle.meta}/>}
        </Container>
    );
};

export default IndexPage;
