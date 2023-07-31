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
import IndexPage from './pages/IndexPage';
import Root from './pages/Root';

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
                <Route path="/4_0_0/Patient/:id?" element={<IndexPage/>}/>
                <Route path="/4_0_0/Practitioner/:id/*" element={<IndexPage/>}/>
                <Route path="/4_0_0/Practitioner/*" element={<IndexPage/>}/>
            </Routes>
        );
    }

    return (
        // https://reactrouter.com/en/main/start/overview
        <RouterProvider router={router}/>
    );
}

export default App;
