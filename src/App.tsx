import React, { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './contexts/ToastContext';
import { AuthProvider } from './contexts/AuthContext';
import { PostsProvider } from './contexts/PostsContext';
import { ComposerProvider } from './contexts/ComposerContext';
import { JobsProvider } from './contexts/JobsContext';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PageSkeleton } from './components/PageSkeleton';
import { BillingStatusBanner } from './components/billing/BillingStatusBanner';

const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const RegisterPage = React.lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = React.lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = React.lazy(() => import('./pages/ResetPasswordPage'));
const AnalyticsPage = React.lazy(() => import('./pages/AnalyticsPage'));
const SchedulerPage = React.lazy(() => import('./pages/SchedulerPage'));
const PredictorPage = React.lazy(() => import('./pages/PredictorPage'));
const SearchPage = React.lazy(() => import('./pages/SearchPage'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = React.lazy(() => import('./pages/NotFoundPage'));

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AuthProvider>
        <PostsProvider>
          <ComposerProvider>
            <JobsProvider>
              <BrowserRouter>
                <RouteErrorBoundary>
                  <BillingStatusBanner />
                  <Suspense fallback={<PageSkeleton />}>
                    <Routes>
                      {/* Public */}
                      <Route path="/login" element={<LoginPage />} />
                      <Route path="/register" element={<RegisterPage />} />
                      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                      <Route path="/reset-password" element={<ResetPasswordPage />} />

                      {/* Protected */}
                      <Route element={<ProtectedRoute />}>
                        <Route path="/" element={<Navigate to="/analytics" replace />} />
                        <Route path="/analytics" element={<AnalyticsPage />} />
                        <Route path="/scheduler" element={<SchedulerPage />} />
                        <Route path="/predictor" element={<PredictorPage />} />
                        <Route path="/search" element={<SearchPage />} />
                        <Route path="/settings/*" element={<SettingsPage />} />
                      </Route>

                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </Suspense>
                </RouteErrorBoundary>
              </BrowserRouter>
            </JobsProvider>
          </ComposerProvider>
        </PostsProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
