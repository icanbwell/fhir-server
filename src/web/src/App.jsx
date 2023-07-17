// import logo from './logo.svg';
import './App.css';
import {BrowserRouter, Routes, Route, Link} from 'react-router-dom';
import HomePage from './HomePage';
import AboutPage from './AboutPage';

import PatientChatGptPage from './PatientChatGptPage';
import ObservationGraph from "./ObservationGraph";
import ObservationTimeline from "./ObservationTimeline";
import PatientTimeline from "./PatientTimeline";
// import ErrorPage from "./error-page";

function App() {
    return (
        <BrowserRouter>
            <nav>
                <ul>
                    <li>
                        <Link to="/">Home</Link>
                    </li>
                    <li>
                        <Link to="/about">About</Link>
                    </li>
                    <li>
                        <Link to="/web/patient">Patient ChatGPT</Link>
                    </li>
                    <li>
                        <Link to="/web/patientTimeline">Patient Timeline</Link>
                    </li>
                    <li>
                        <Link to="/web/observationGraph">Observation Graph</Link>
                    </li>
                    <li>
                        <Link to="/web/observationTimeline">Observation Timeline</Link>
                    </li>
                </ul>
            </nav>

            <Routes>
                <Route path="/" element={<HomePage/>}/>
                <Route path="/about" element={<AboutPage/>}/>
                <Route path="/web/patient" element={<PatientChatGptPage/>}/>
                <Route path="/web/patientTimeline" element={<PatientTimeline/>}/>
                <Route path="/web/observationGraph" element={<ObservationGraph/>}/>
                <Route path="/web/observationTimeline" element={<ObservationTimeline/>}/>
            </Routes>
        </BrowserRouter>
    );
}

export default App;
