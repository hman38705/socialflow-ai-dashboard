import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SettingsPage } from './pages/SettingsPage';
import { BillingStatusBanner } from './components/billing/BillingStatusBanner';

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <BillingStatusBanner />
      <Routes>
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="/" element={<Navigate to="/settings" replace />} />
        <Route path="*" element={<Navigate to="/settings" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
