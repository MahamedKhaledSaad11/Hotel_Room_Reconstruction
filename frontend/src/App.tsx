import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { ProjectsProvider } from './context/ProjectsContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { GuestOnlyRoute, ProtectedRoute } from './components/auth/RouteGuards';
import { SpacesPage } from './pages/SpacesPage';
import { ScanRoomPage } from './pages/ScanRoomPage';
import { ProgressPage } from './pages/ProgressPage';
import { StudioPage } from './pages/StudioPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharedStudioPage } from './pages/SharedStudioPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignUpPage } from './pages/auth/SignUpPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { SetNewPasswordPage } from './pages/auth/SetNewPasswordPage';
import { PasswordResetSuccessPage } from './pages/auth/PasswordResetSuccessPage';

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <ProjectsProvider>
            <BrowserRouter>
              <Routes>
                {/* Public client share & password recovery routes */}
                <Route path="/shared/:shareToken" element={<SharedStudioPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/set-new-password" element={<SetNewPasswordPage />} />
                <Route path="/password-reset-success" element={<PasswordResetSuccessPage />} />

                {/* Guest-only auth routes in Live Mode */}
                <Route element={<GuestOnlyRoute />}>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignUpPage />} />
                </Route>

                {/* Authenticated / Demo Sandbox workspace routes */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/" element={<SpacesPage />} />
                  <Route path="/spaces" element={<SpacesPage />} />
                  <Route path="/scan" element={<ScanRoomPage />} />
                  <Route path="/progress" element={<ProgressPage />} />
                  <Route path="/progress/:taskId" element={<ProgressPage />} />
                  <Route path="/studio" element={<StudioPage />} />
                  <Route path="/studio/:projectId" element={<StudioPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/spaces" replace />} />
              </Routes>
            </BrowserRouter>
          </ProjectsProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;
