import React, { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { SafeImage } from '../../components/common/SafeImage';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { STITCH_IMAGES } from '../../data/mockData';

interface LoginLocationState {
  prefilledEmail?: string;
  signupBanner?: string;
}

export const LoginPage: React.FC = () => {
  const { demoMode, signIn, signInWithDemoProvider } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const locState = (location.state as LoginLocationState | null) || null;
  const rawNext = searchParams.get('next');
  const nextPath =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/spaces';

  const [email, setEmail] = useState(
    locState?.prefilledEmail || (demoMode ? 'elena.rostova@ateliernord.com' : '')
  );
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid work or personal email address.');
      return;
    }
    if (password.length < 1) {
      setError('Please enter your atelier password.');
      return;
    }
    setSubmitting(true);
    try {
      await signIn(email, password, remember);
      showToast('Welcome back to AuraSpace Atelier', 'success');
      navigate(nextPath, { replace: true });
    } catch (err) {
      const msg =
        err instanceof Error && err.message ? err.message : 'Unable to sign in. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSocial = (provider: 'Google' | 'Apple') => {
    signInWithDemoProvider(provider);
    showToast(`Signed in via ${provider} Demo Pass`, 'success');
    navigate('/spaces');
  };

  return (
    <AuthShell>
      <div className="relative w-full max-w-7xl mx-auto px-6 lg:px-12 py-8 lg:py-14 flex items-center justify-center">
        <div className="absolute -top-12 -left-12 w-96 h-96 bg-primary-fixed/30 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-4 right-1/4 w-80 h-80 bg-secondary-fixed/25 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          {/* Left Column: Spatial Showcase */}
          <div className="lg:col-span-7 flex flex-col justify-between rounded-xl overflow-hidden relative min-h-[520px] lg:min-h-[660px] shadow-xl bg-inverse-surface">
            <SafeImage
              src={STITCH_IMAGES.loginShowcase}
              alt="Sun-drenched penthouse interior space rendered with 3D Gaussian splats"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-on-surface/85 via-on-surface/25 to-surface/20" />
            <div className="absolute inset-0 bg-primary-deep/10 mix-blend-multiply" />

            <div className="relative z-10 p-6 lg:p-8 flex items-start justify-between gap-2 flex-wrap">
              <div className="backdrop-blur-md bg-surface/85 px-4 py-2 rounded-full shadow-md flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-secondary-container animate-pulse" />
                <span className="text-[11px] font-semibold text-on-surface uppercase tracking-wider">
                  Penthouse Living Room
                </span>
                <span className="text-outline-variant text-xs">•</span>
                <span className="text-[11px] text-primary-deep font-semibold">
                  3D Gaussian Walkthrough Ready
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 backdrop-blur-md bg-surface/80 px-3 py-1.5 rounded-full shadow-sm">
                <span className="material-symbols-outlined text-[16px] text-tertiary">
                  wb_sunny
                </span>
                <span className="text-[11px] font-semibold text-on-surface">
                  10:45 AM Natural Light
                </span>
              </div>
            </div>

            <div className="relative z-10 p-6 lg:p-10 flex flex-col gap-4 text-surface">
              <div className="flex items-center gap-4 backdrop-blur-xl bg-surface-container-lowest/85 text-on-surface p-3 px-4 rounded-lg w-fit shadow-md max-w-md">
                <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-primary-deep">
                  <span className="material-symbols-outlined text-[20px]">view_in_ar</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-outline tracking-wider uppercase font-semibold">
                    Spatial Capture Matrix
                  </span>
                  <span className="text-xs text-on-surface font-semibold">
                    9.4M Splat Radiance Points • 60 FPS
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex text-secondary-fixed">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <span
                      key={idx}
                      className="material-symbols-outlined text-[18px] icon-filled"
                    >
                      star
                    </span>
                  ))}
                </div>
                <p className="font-headline text-xl sm:text-2xl italic text-surface leading-snug">
                  “AuraSpace turned our simple iPhone walkthroughs into client-ready 3D spaces in
                  minutes.”
                </p>
                <div className="flex items-center gap-2.5 pt-1">
                  <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-muted text-xs font-semibold">
                    EL
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-surface">Elena Lindqvist</span>
                    <span className="text-[10px] text-surface/80">
                      Principal Architect, Atelier Nord
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Sign-In Form */}
          <div className="lg:col-span-5 flex flex-col justify-center bg-surface-container-lowest rounded-xl p-8 lg:p-12 shadow-lg relative border border-border-sand/60">
            <span className="absolute top-6 right-8 text-[10px] font-semibold text-outline/70 tracking-widest uppercase pointer-events-none select-none">
              SECURE ATELIER
            </span>

            <div className="space-y-2 mb-8">
              <h1 className="font-headline text-3xl sm:text-4xl text-on-surface tracking-tight">
                Welcome back to your atelier
              </h1>
              <p className="text-sm text-on-surface-muted leading-relaxed">
                Sign in to access your scanned spaces, furniture restyling, and 3D walkthroughs.
              </p>
            </div>

            <div className="bg-surface-container-high p-1 rounded-lg flex items-center mb-6">
              <div className="flex-1 py-2 text-center rounded-md bg-surface text-primary-deep font-semibold text-sm shadow-sm">
                Sign In
              </div>
              <Link
                to="/signup"
                className="flex-1 py-2 text-center rounded-md text-on-surface-muted hover:text-on-surface font-semibold text-sm transition-colors"
              >
                Create Account
              </Link>
            </div>

            {demoMode && (
              <>
                <div className="grid grid-cols-2 gap-2.5 mb-6">
                  <button
                    type="button"
                    onClick={() => handleSocial('Google')}
                    className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface transition-colors shadow-sm group border border-border-sand/60"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        fill="#EA4335"
                      />
                    </svg>
                    <span className="text-xs font-semibold group-hover:text-primary-deep transition-colors">
                      Google (Demo)
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocial('Apple')}
                    className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface transition-colors shadow-sm group border border-border-sand/60"
                  >
                    <svg className="w-4 h-4 fill-current text-on-surface" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.76 1.06-1.81.94-2.87-.91.04-2.02.61-2.67 1.37-.58.67-1.09 1.74-.95 2.78 1.02.08 2.05-.52 2.68-1.28z" />
                    </svg>
                    <span className="text-xs font-semibold group-hover:text-primary-deep transition-colors">
                      Apple (Demo)
                    </span>
                  </button>
                </div>

                <div className="relative flex items-center justify-center mb-6">
                  <div className="w-full h-px bg-surface-container-high" />
                  <span className="absolute px-3 bg-surface-container-lowest text-[10px] font-semibold text-outline uppercase tracking-wider">
                    or continue with email
                  </span>
                </div>
              </>
            )}

            {locState?.signupBanner && (
              <div
                role="status"
                className="mb-4 rounded-lg bg-tertiary-fixed text-tertiary-deep px-3.5 py-2.5 text-xs font-semibold flex items-center gap-2 border border-tertiary-fixed-dim"
              >
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>{locState.signupBanner}</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mb-4 rounded-lg bg-error-container text-on-error-container px-3.5 py-2.5 text-xs font-medium flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{error}</span>
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-on-surface" htmlFor="login-email">
                  Work or Personal Email
                </label>
                <div className="relative flex items-center">
                  <span className="material-symbols-outlined absolute left-3.5 text-outline text-[18px] pointer-events-none">
                    mail
                  </span>
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="designer@studio.com"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline/60 text-sm focus:outline-none focus:bg-surface-container focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className="block text-xs font-semibold text-on-surface"
                    htmlFor="login-password"
                  >
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-[11px] font-semibold text-primary-deep hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative flex items-center">
                  <span className="material-symbols-outlined absolute left-3.5 text-outline text-[18px] pointer-events-none">
                    lock
                  </span>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your atelier password"
                    className="w-full pl-10 pr-11 py-2.5 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline/60 text-sm focus:outline-none focus:bg-surface-container focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                  <button
                    type="button"
                    aria-label="Toggle password visibility"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 text-outline hover:text-on-surface p-1 rounded transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="w-4 h-4 rounded text-primary focus:ring-0 accent-primary cursor-pointer"
                  />
                  <span className="text-xs text-on-surface-muted">
                    Remember this device for 30 days
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-3 px-6 rounded-lg bg-primary-container-deep hover:bg-primary-deep text-on-primary font-semibold text-sm flex items-center justify-center gap-2 shadow-md transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60"
              >
                <span>{submitting ? 'Entering Atelier...' : 'Enter Atelier'}</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </form>

            <div className="mt-7 bg-surface-container-low rounded-lg p-4 text-center space-y-2">
              <p className="text-xs text-on-surface-muted">
                New to AuraSpace?{' '}
                <Link
                  to="/signup"
                  className="font-semibold text-primary-deep hover:underline inline-flex items-center gap-0.5"
                >
                  <span>Create an account for free 3D captures</span>
                  <span className="material-symbols-outlined text-[14px]">north_east</span>
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </AuthShell>
  );
};
