import React from 'react';
import {Route} from 'react-router-dom';
import AdminIndexPage from "../admin";
import PersonMatchPage from "../admin/personMatch";
import PatientDataPage from "../admin/patientData";
import PersonPatientLinkPage from "../admin/personPatientLink";
import SearchLogsPage from "../admin/searchLogs";

const AdminRoutes: React.FC = () => {
    return (
        <>
            <Route path="/admin" element={<AdminIndexPage/>}/>
            <Route path="/admin/personMatch/*" element={<PersonMatchPage/>}/>
            <Route path="/admin/patientData/*" element={<PatientDataPage/>}/>
            <Route path="/admin/personPatientLink/*" element={<PersonPatientLinkPage/>}/>
            <Route path="/admin/searchLog/*" element={<SearchLogsPage/>}/>
        </>
    );
};

export default AdminRoutes;
