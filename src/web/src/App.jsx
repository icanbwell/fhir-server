import './App.css';
import React from 'react';
import {
    BrowserRouter,
    Routes,
    Route,
    Link,
    createBrowserRouter,
    createRoutesFromElements,
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
            {
                "path": "/",
                element: <HomePage/>
            }
        ],
        // createRoutesFromElements(
        //     <Routes>
        //         <Route path="/" element={<HomePage/>}/>
        //         {/*<Route path="about" element={<AboutPage/>}/>*/}
        //         {/*<Route path="patient" element={<PatientChatGptPage/>}/>*/}
        //         {/*<Route path="pat2/:id" element={<PatientChatGptPage/>}/>*/}
        //         {/*<Route path="patientTimeline" element={<PatientTimeline/>}/>*/}
        //         {/*<Route path="observationGraph" element={<ObservationGraph/>}/>*/}
        //         {/*<Route path="observationTimeline" element={<ObservationTimeline/>}/>*/}
        //         {/*<Route path="4_0_0/Patient/id:?" element={<IndexPage/>}/>*/}
        //         {/*<Route path="4_0_0/Practitioner/" element={<IndexPage/>}*/}
        //         {/*       errorElement={<p>Oops! Something Went Wrong</p>}/>*/}
        //         {/*<Route path="/4_0_0/Practitioner/id:?" element={<IndexPage/>}/>*/}
        //     </Routes>
        // ),
        {basename: "/web"}
    );
    return (
        // https://reactrouter.com/en/main/start/overview
        <React.StrictMode>
            <RouterProvider router={router}/>
        </React.StrictMode>
    );
}

export default App;
