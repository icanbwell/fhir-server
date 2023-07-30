// import logo from './logo.svg';
import './App.css';
import {BrowserRouter, Routes, Route, Link} from 'react-router-dom';
import HomePage from './HomePage';
import AboutPage from './AboutPage';

import PatientChatGptPage from './PatientChatGptPage';
import ObservationGraph from "./ObservationGraph";
import ObservationTimeline from "./ObservationTimeline";
import PatientTimeline from "./PatientTimeline";
import IndexPage from './pages/IndexPage';
// import ErrorPage from "./error-page";

function App() {
    return (
        <BrowserRouter basename="/web">
            <nav>
                <ul>
                    <li>
                        <Link to="/">Home</Link>
                    </li>
                    <li>
                        <Link to="/about">About</Link>
                    </li>
                    <li>
                        <Link to="/patient">Patient ChatGPT</Link>
                    </li>
                    <li>
                        <Link to="/pat2/123">Patient2 ChatGPT</Link>
                    </li>
                    <li>
                        <Link to="/patientTimeline">Patient Timeline</Link>
                    </li>
                    <li>
                        <Link to="/observationGraph">Observation Graph</Link>
                    </li>
                    <li>
                        <Link to="/observationTimeline">Observation Timeline</Link>
                    </li>
                    <li>
                        <Link to="/4_0_0/Patient">Patient Page</Link>
                    </li>
                </ul>
            </nav>

            <Routes>
                <Route path="/" element={<HomePage/>}/>
                <Route path="/about" element={<AboutPage/>}/>
                <Route path="/patient" element={<PatientChatGptPage/>}/>
                <Route path="/pat2/:id" element={<PatientChatGptPage/>}/>
                <Route path="/patientTimeline" element={<PatientTimeline/>}/>
                <Route path="/observationGraph" element={<ObservationGraph/>}/>
                <Route path="/observationTimeline" element={<ObservationTimeline/>}/>
                <Route path="/4_0_0/Patient" element={<IndexPage/>}/>
            </Routes>
        </BrowserRouter>
    );
}

export default App;
