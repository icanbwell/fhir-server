import React from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import {Line} from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

const observations = [
    {
        date: 'May 26, 2022',
        category: 'Laboratory',
        code: 'Total score [DAST-10] (LOINC code: 82667-7)',
        value: 2,
    },
    {
        date: 'May 9, 2019',
        category: 'Laboratory',
        code: 'Total score [DAST-10] (LOINC code: 82667-7)',
        value: 1,
    },
    {
        date: 'May 3, 2018',
        category: 'Laboratory',
        code: 'Total score [DAST-10] (LOINC code: 82667-7)',
        value: 2,
    },
];
const chartData = {
    labels: observations.map(obs => obs.date),
    datasets: [
        {
            label: 'DAST-10 Scores',
            data: observations.map(obs => obs.value),
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 2,
        },
    ],
};

const chartOptions = {
    scales: {
        y: {
            beginAtZero: true,
        },
    },
};

const ObservationGraph = () => {
    return <Line data={chartData} options={chartOptions}/>;
};


export default ObservationGraph;
