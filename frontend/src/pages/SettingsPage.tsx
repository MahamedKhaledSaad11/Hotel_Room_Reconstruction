import React, { useEffect, useState } from 'react';
import { AppHeader } from '../components/layout/AppHeader';
import { AppFooter } from '../components/layout/AppFooter';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';

export const SettingsPage: React.FC = () => {
  const { user, settings, updateProfile, changePassword, updateSettings } =
    useAuth();
  const { showToast } = useToast();
  const [fullName, setFullName] = useState(user.fullName);
  const [studioName, setStudioName] = useState(user.studioName);
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [estimator, setEstimator] = useState(settings.defaultPoseEstimator);
  const [resolution, setResolution] = useState(settings.defaultMaxResolution);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState('');
  const [connection, setConnection] = useState('');
  useEffect(() => {
    setFullName(user.fullName);
    setStudioName(user.studioName);
  }, [user.fullName, user.studioName]);
  const input =
    'mt-2 block w-full rounded-xl border border-border-sand bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
  const button =
    'rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50';
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy('profile');
    try {
      await updateProfile({
        fullName: fullName.trim(),
        studioName: studioName.trim(),
      });
      showToast('Profile updated.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Unable to save profile.',
        'error'
      );
    } finally {
      setBusy('');
    }
  };
  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmation) {
      showToast('New passwords do not match.', 'error');
      return;
    }
    setBusy('password');
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      showToast('Password changed.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Unable to change password.',
        'error'
      );
    } finally {
      setBusy('');
    }
  };
  const saveDefaults = (event: React.FormEvent) => {
    event.preventDefault();
    const value = apiBaseUrl.trim().replace(/\/+$/, '');
    if (value && !/^https?:\/\//i.test(value) && !value.startsWith('/')) {
      showToast('Use an HTTPS URL or an absolute path such as /api.', 'error');
      return;
    }
    updateSettings({
      apiBaseUrl: value,
      defaultPoseEstimator: estimator,
      defaultMaxResolution: resolution,
    });
    showToast('Capture defaults saved.', 'success');
  };
  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col">
      <AppHeader />
      <main className="pt-28 pb-16 px-6 sm:px-8 max-w-5xl mx-auto w-full flex-1">
        <h1 className="font-headline text-4xl mb-2">Studio Settings</h1>
        <p className="text-on-surface-variant mb-9">
          Manage your account and room capture defaults.
        </p>
        <div className="grid md:grid-cols-2 gap-6 items-start">
          <form
            onSubmit={saveProfile}
            className="rounded-3xl border border-border-sand bg-surface-container-lowest p-6 sm:p-8 space-y-5 shadow-soft"
          >
            <h2 className="font-headline text-2xl">Your account</h2>
            <p className="text-sm text-on-surface-variant break-all">
              {user.email}
            </p>
            <label className="block text-xs font-semibold">
              Full name
              <input
                required
                maxLength={120}
                autoComplete="name"
                className={input}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold">
              Studio name
              <input
                maxLength={120}
                className={input}
                value={studioName}
                onChange={(event) => setStudioName(event.target.value)}
              />
            </label>
            <button type="submit" disabled={Boolean(busy)} className={button}>
              {busy === 'profile' ? 'Saving…' : 'Save profile'}
            </button>
          </form>
          <form
            onSubmit={saveDefaults}
            className="rounded-3xl border border-border-sand bg-surface-container-lowest p-6 sm:p-8 space-y-5 shadow-soft"
          >
            <h2 className="font-headline text-2xl">Capture defaults</h2>
            <label className="block text-xs font-semibold">
              Backend URL
              <input
                className={input}
                placeholder="/api"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
              />
            </label>
            <p className="text-xs text-on-surface-variant">
              Leave blank to use the configured application backend.
            </p>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={async () => {
                setBusy('connection');
                setConnection('Checking connection…');
                try {
                  const result = await api.testConnection(apiBaseUrl);
                  setConnection(result.message);
                } catch (error) {
                  setConnection(
                    error instanceof Error
                      ? error.message
                      : 'Connection failed.'
                  );
                } finally {
                  setBusy('');
                }
              }}
              className="text-sm font-semibold text-primary disabled:opacity-50"
            >
              Test connection
            </button>
            {connection && (
              <p role="status" className="text-xs text-on-surface-variant">
                {connection}
              </p>
            )}
            <label className="block text-xs font-semibold">
              Pose estimator
              <select
                className={input}
                value={estimator}
                onChange={(event) =>
                  setEstimator(event.target.value as 'GLOMAP' | 'VGGT')
                }
              >
                <option value="GLOMAP">GLOMAP</option>
                <option value="VGGT">VGGT</option>
              </select>
            </label>
            <label className="block text-xs font-semibold">
              Maximum frame size
              <select
                className={input}
                value={resolution}
                onChange={(event) =>
                  setResolution(Number(event.target.value) as 640 | 768 | 960)
                }
              >
                <option value={640}>640 px</option>
                <option value={768}>768 px</option>
                <option value={960}>960 px</option>
              </select>
            </label>
            <button type="submit" disabled={Boolean(busy)} className={button}>
              Save defaults
            </button>
          </form>
          <form
            onSubmit={savePassword}
            className="md:col-span-2 rounded-3xl border border-border-sand bg-surface-container-lowest p-6 sm:p-8 space-y-5 shadow-soft"
          >
            <h2 className="font-headline text-2xl">Change password</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              <label className="block text-xs font-semibold">
                Current password
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  className={input}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
              <label className="block text-xs font-semibold">
                New password
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  className={input}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label className="block text-xs font-semibold">
                Confirm new password
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  className={input}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </div>
            <button type="submit" disabled={Boolean(busy)} className={button}>
              {busy === 'password' ? 'Changing…' : 'Change password'}
            </button>
          </form>
        </div>
      </main>
      <AppFooter />
    </div>
  );
};
