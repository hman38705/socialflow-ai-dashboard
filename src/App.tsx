import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { PredictorPage } from './pages/PredictorPage';
import SearchPage from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { BillingStatusBanner } from './components/billing/BillingStatusBanner';

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <BillingStatusBanner />
      <Routes>
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/predictor" element={<PredictorPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="/" element={<Navigate to="/analytics" replace />} />
        <Route path="*" element={<Navigate to="/analytics" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
