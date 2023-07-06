import React, {useState} from 'react';

function PatientChatGptPage() {
    const [textInput, setTextInput] = useState('');

    const handleInputChange = (event) => {
        setTextInput(event.target.value);
    };

    const callApi = () => {
        fetch('https://api.example.com/endpoint', {
            method: 'GET',
            // Additional headers or body if needed
        })
            .then(response => response.json())
            .then(data => {
                // Process the API response
                console.log(data);
            })
            .catch(error => {
                console.error(error);
            });
    };

    return (
        <div>
            {/*<input type="text" value={textInput} onChange={handleInputChange}/>*/}
            {/*<button onClick={callApi}>Ask</button>*/}
        </div>
    );
}

export default PatientChatGptPage;

