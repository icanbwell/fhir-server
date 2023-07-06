import React from 'react';
import { BrowserRouter, Route, Link } from 'react-router-dom';
import HomePage from './HomePage';
import PatientChatGptPage from './PatientChatGptPage';

function App() {
  return (
    <BrowserRouter>
      <div>
        <h1>My App</h1>
        <nav>
          <ul>
            <li>
              <Link to="/">Home</Link>
            </li>
            <li>
              <Link to="/chatgpt">ChatGpt</Link>
            </li>
          </ul>
        </nav>

        <Route exact path="/" component={HomePage} />
        <Route path="/chatgpt" component={PatientChatGptPage} />
      </div>
    </BrowserRouter>
  );
}

export default App;
