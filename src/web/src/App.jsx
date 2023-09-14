import './App.css';
import React from 'react';
import {
    Routes,
    Route,
    createBrowserRouter,
    RouterProvider
} from 'react-router-dom';
import HomePage from './HomePage';
import AboutPage from './AboutPage';

import PatientChatGptPage from './PatientChatGptPage';
import ObservationGraph from "./ObservationGraph";
import ObservationTimeline from "./ObservationTimeline";
import PatientTimeline from "./PatientTimeline";
import AdminRoutes from "./routes/adminRoutes";
import FhirRoutes from "./routes/fhirRoutes";
import AdminIndexPage from "./admin";
import PersonMatchPage from "./admin/personMatch";
import PatientDataPage from "./admin/patientData";
import PersonPatientLinkPage from "./admin/personPatientLink";
import SearchLogsPage from "./admin/searchLogs";
import SearchPage from "./pages/SearchPage";
import IndexPage from "./pages/IndexPage";

// import ErrorPage from "./error-page";

function App() {
    const router = createBrowserRouter(
        [
            {path: "*", Component: Root},
        ],
        {basename: "/"}
    );

    // 1️Changed from App to Root
    function Root() {
        return (
            <Routes>
                <Route path="/" element={<HomePage/>}/>
                <Route path="/about" element={<AboutPage/>}/>
                <Route path="/patient" element={<PatientChatGptPage/>}/>
                <Route path="/pat2/:id" element={<PatientChatGptPage/>}/>
                <Route path="/patientTimeline" element={<PatientTimeline/>}/>
                <Route path="/observationGraph" element={<ObservationGraph/>}/>
                <Route path="/observationTimeline" element={<ObservationTimeline/>}/>
                <Route path="/4_0_0/:resourceType/_search/*" element={<SearchPage/>}/>
                <Route path="/4_0_0/:resourceType/:id?/:operation?/*" element={<IndexPage/>}/>
                <Route path="/4_0_0/:resourceType/:operation?/*" element={<IndexPage/>}/>
                <Route path="/admin" element={<AdminIndexPage/>}/>
                <Route path="/admin/personMatch/*" element={<PersonMatchPage/>}/>
                <Route path="/admin/patientData/*" element={<PatientDataPage/>}/>
                <Route path="/admin/personPatientLink/*" element={<PersonPatientLinkPage/>}/>
                <Route path="/admin/searchLog/*" element={<SearchLogsPage/>}/>
            </Routes>
        );
    }

    return (
        // https://reactrouter.com/en/main/start/overview
        <RouterProvider router={router}/>
    );
}

export default App;
