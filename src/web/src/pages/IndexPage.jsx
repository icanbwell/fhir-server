import React from 'react';
import { useLocation } from 'react-router-dom';
import Head from '../partials/Head';
import Header from '../partials/Header';
import Footer from '../partials/Footer';
import {useEffect, useState} from 'react';
import FhirApi from '../fhirApi';
import ResourceHeader from '../partials/ResourceHeader';
import Practitioner from './Practitioner';

// Main Component
const IndexPage = ({id}) => {
    const [
        /** @type {Object[]} */ resources,
        setResources
    ] = useState('');

    const [
        /** @type {Object} */ bundle,
        setBundle
    ] = useState('');

    const location = useLocation();
    const queryString = location.search;
    const searchParams = new URLSearchParams(location.search);

    console.log('Full query string:', queryString);

    useEffect(() => {
        const callApi = async () => {
            try {
                // const patientId = `john-muir-health-e.k-4ea143ZrQGvdUvf-b2y.tdyiVMBWgblY4f6y2zis3`;
                // const id = `1679033641-1`;
                const resourceType = `Practitioner`;
                const fhirApi = new FhirApi();
                const data = await fhirApi.getBundleAsync({resourceType});
                console.log('Page received data');
                console.log(data);
                if (data.entry) {
                    setResources(data.entry);
                    setBundle(data);
                } else {
                    setResources([data]);
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