import React from 'react';
import {Route} from 'react-router-dom';
import SearchPage from "../pages/SearchPage";
import IndexPage from '../pages/IndexPage';

const FhirRoutes = () => {
    return (
        <>
            <Route path="/4_0_0/:resourceType/_search/*" element={<SearchPage/>}/>
            <Route path="/4_0_0/:resourceType/:id?/:operation?/*" element={<IndexPage/>}/>
            <Route path="/4_0_0/:resourceType/:operation?/*" element={<IndexPage/>}/>
        </>
    );
};

export default FhirRoutes;
