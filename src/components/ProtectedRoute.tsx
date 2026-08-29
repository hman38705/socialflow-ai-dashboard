import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * Layout route (FE-003) gating every authenticated page. Renders its
 * child routes via <Outlet /> once AuthContext resolves to
 * 'authenticated'; redirects to /login otherwise, preserving the
 * originally requested location so login can return there afterwards.
 */
export function ProtectedRoute(): React.JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-blue border-t-transparent" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
