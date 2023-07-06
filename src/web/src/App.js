import logo from './logo.svg';
import './App.css';
import {BrowserRouter as Router, Route, Link, Routes} from 'react-router-dom';

import HomePage from './HomePage';
// import PatientChatGptPage from './PatientChatGptPage';

function App() {
    return (
        <Router>
            <div>
                <nav>
                    <ul>
                        <li>
                            <Link to="/">Home</Link>
                        </li>
                    </ul>
                </nav>

                <Routes>
                    <Route exact path="/" component={HomePage}/>
                </Routes>
            </div>
        </Router>
    );
}

export default App;
