import React from 'react';
import {useLocation, useParams} from 'react-router-dom';
import Head from '../partials/Head';
import Header from '../partials/Header';
import Footer from '../partials/Footer';
import {useEffect, useState} from 'react';
import FhirApi from '../fhirApi';
import ResourceHeader from '../partials/ResourceHeader';
import Practitioner from './Practitioner';

// Main Component
const IndexPage = () => {
    const [
        /** @type {Object[]} */ resources,
        setResources
    ] = useState('');

    const [
        /** @type {Object} */ bundle,
        setBundle
    ] = useState('');

    const [
        /** @type {Object} */ status,
        setStatus
    ] = useState('');

    const {id} = useParams();

    const location = useLocation();
    const queryString = location.search;
    const searchParams = new URLSearchParams(location.search);

    function getMain() {
        return <>
            {resources && resources.map((fullResource, index) => {
                const resource = fullResource.resource || fullResource;
                return (
                    // <ResourceItem
                    //     key={index}
                    //     res={res}
                    //     fullResource={fullResource}
                    //     index={index}
                    // />
                    // <div>id: {res.id}</div>
                    <React.Fragment>
                        <ResourceHeader resource={resource}/>
                        <Practitioner resource={resource} index={index}/>
                    </React.Fragment>

                );
            })}
        </>;
    }

    console.log('id: ', id);
    console.log('Full query string: ', queryString);

    useEffect(() => {
        const callApi = async () => {
            try {
                // const patientId = `john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3`;
                // const id = `1679033641-1`;
                const resourceType = `Practitioner`;
                const fhirApi = new FhirApi();
                const {json, status} = await fhirApi.getBundleAsync({resourceType, id, queryString});
                console.log('Page received data');
                console.log(json);
                setStatus(status);
                if (json.entry) {
                    setResources(json.entry);
                    setBundle(json);
                } else {
                    console.log('Received non-bundle:', json);
                    setResources([json]);
                }
            } catch (error) {
                console.error(error);
            }
        };
        callApi()
            // make sure to catch any error
            .catch(console.error);
    }, []);

    return (
        <html lang="en">
        <head>
            <Head/>
        </head>
        <body className="container-fluid p-0">
        <Header resources={resources}/>
        <main>
            {status === 200 ? getMain() : <div>Not Found</div>}
        </main>
        {
            bundle && (
                <Footer url={bundle.url} meta={bundle.meta}/>
            )
        }
        </body>
        </html>
    );
};

export default IndexPage;
