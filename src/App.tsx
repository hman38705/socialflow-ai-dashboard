import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { PredictiveReachDashboard } from './components/dashboard/PredictiveReachDashboard';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SchedulerPage } from './pages/SchedulerPage';
import { PredictorPage } from './pages/PredictorPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { ComposerProvider } from './contexts/ComposerContext';
import { PostsProvider } from './contexts/PostsContext';
import { useAuth } from './contexts/AuthContext';

function App() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <PostsProvider>
      <ComposerProvider>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<PredictiveReachDashboard />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/scheduler" element={<SchedulerPage />} />
            <Route path="/predictor" element={<PredictorPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ComposerProvider>
    </PostsProvider>
  );
}

export default App;
