import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const AuthLoadingScreen: React.FC = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface px-6 text-center">
    <span className="material-symbols-outlined text-4xl text-primary animate-spin mb-3">
      progress_activity
    </span>
    <p className="font-headline text-xl text-on-surface">Verifying Atelier Session...</p>
    <p className="text-xs text-on-surface-variant mt-1">
      Checking credentials with AuraSpace backend
    </p>
  </div>
);

export const ProtectedRoute: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { demoMode, isAuthenticated, authChecking } = useAuth();
  const location = useLocation();

  if (authChecking) {
    return <AuthLoadingScreen />;
  }

  if (!demoMode && !isAuthenticated) {
    const nextPath = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(nextPath)}`} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};

export const GuestOnlyRoute: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { demoMode, isAuthenticated, authChecking } = useAuth();

  if (authChecking) {
    return <AuthLoadingScreen />;
  }

  if (!demoMode && isAuthenticated) {
    return <Navigate to="/spaces" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};
