import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import PatientApp from './pages/PatientApp';
import { I18nProvider } from './i18n';
// Workspaces are code-split so patients never download the doctor/clinic/admin bundles
const PatientLogin = lazy(() => import('./pages/PatientLogin'));
const DoctorApp = lazy(() => import('./pages/DoctorApp'));
const ClinicApp = lazy(() => import('./pages/ClinicApp'));
const AdminApp = lazy(() => import('./pages/AdminApp'));
const DoctorProfilePage = lazy(() => import('./pages/DoctorProfilePage'));
const ManageAppointment = lazy(() => import('./pages/ManageAppointment'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

const Loading = () => <div className="fx-center" style={{ minHeight: '60vh' }}>Loading…</div>;

export default function App() {
  return (
    <I18nProvider>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
      <Routes>
        {/* Patient discovery & booking */}
        <Route path="/" element={<PatientApp />} />
        <Route path="/find" element={<PatientApp />} />
        <Route path="/clinics" element={<PatientApp />} />
        <Route path="/bookings" element={<PatientApp />} />
        <Route path="/profile" element={<PatientApp />} />
        <Route path="/records" element={<PatientApp />} />
        <Route path="/labs" element={<PatientApp />} />
        <Route path="/account/privacy" element={<PatientApp />} />
        {/* Signed reminder links + legal pages */}
        <Route path="/appointment/:token" element={<ManageAppointment />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/grievance" element={<LegalPage kind="grievance" />} />
        <Route path="/login" element={<PatientLogin />} />
        {/* Shareable / SEO doctor pages */}
        <Route path="/doctors/:slug" element={<DoctorProfilePage />} />

        {/* Doctor & clinic workspaces (OTP sign-in) */}
        <Route path="/doctor" element={<DoctorApp />} />
        <Route path="/doctor/login" element={<Navigate to="/doctor" replace />} />
        <Route path="/clinic" element={<ClinicApp />} />
        <Route path="/clinic/login" element={<Navigate to="/clinic" replace />} />

        {/* Admin console */}
        <Route path="/admin/*" element={<AdminApp />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </I18nProvider>
  );
}
