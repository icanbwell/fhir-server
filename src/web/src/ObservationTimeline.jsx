import React from 'react';
import {VerticalTimeline, VerticalTimelineElement} from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import MedicalInformationIcon from '@mui/icons-material/MedicalInformation';

const renderTimelineElements = (observations) => {
    return observations.map((observation, index) => (
        <VerticalTimelineElement
            className="vertical-timeline-element--work"
            contentStyle={{background: 'rgb(33, 150, 243)', color: '#fff'}}
            contentArrowStyle={{borderRight: '7px solid  rgb(33, 150, 243)'}}
            key={index}
            date={observation.date}
            iconStyle={{background: '#007bff', color: '#fff'}} // Customize the icon color if needed
            icon={<MedicalInformationIcon/>}
        >
            <h3 className="vertical-timeline-element-title">{observation.code}</h3>
            <p className="vertical-timeline-element-subtitle">{observation.category}</p>
            <p>{`Value: ${observation.value}`}</p>
        </VerticalTimelineElement>
    ));
};

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

const ObservationTimeline = () => {
    return (
        <VerticalTimeline>
            {renderTimelineElements(observations)}
        </VerticalTimeline>
    );
};


export default ObservationTimeline;
