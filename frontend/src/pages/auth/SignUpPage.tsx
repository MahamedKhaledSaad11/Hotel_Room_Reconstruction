import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { SafeImage } from '../../components/common/SafeImage';
import { InfoModalTopic, InfoTopicModal } from '../../components/modals/InfoModals';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { STITCH_IMAGES } from '../../data/mockData';
import { UserPracticeRole } from '../../types';

const ROLES: UserPracticeRole[] = [
  'Interior Designer',
  'Architect',
  'Homeowner / Enthusiast',
  '3D Stylist',
];

export const SignUpPage: React.FC = () => {
  const { demoMode, signUp, signInWithDemoProvider } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserPracticeRole>('Interior Designer');
  const [agreedTerms, setAgreedTerms] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [infoTopic, setInfoTopic] = useState<InfoModalTopic>(null);

  const strength = useMemo(() => {
    if (!password) {
      return { score: 0, label: 'Enter password', color: 'bg-surface-container-high' };
    }
    if (password.length < 5) {
      return { score: 1, label: 'Warm start', color: 'bg-secondary' };
    }
    if (password.length < 9) {
      return { score: 2, label: 'Travertine medium', color: 'bg-secondary' };
    }
    if (!/[0-9]/.test(password) && !/[^A-Za-z0-9]/.test(password)) {
      return { score: 3, label: 'Atelier steady', color: 'bg-primary-deep' };
    }
    return { score: 4, label: 'Linen strong', color: 'bg-tertiary-deep' };
  }, [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must be at least 8 characters and include both a letter and a number.');
      return;
    }
    if (!agreedTerms) {
      setError('Please accept the Terms of Service & Privacy Policy.');
      return;
    }

    setSubmitting(true);
    try {
      await signUp({ fullName, email, password, role: selectedRole });
      if (demoMode) {
        showToast('Atelier account created! Ready to scan rooms.', 'success');
        navigate('/spaces');
      } else {
        showToast('Account created! Please sign in with your new credentials.', 'success');
        navigate('/login', {
          replace: true,
          state: {
            prefilledEmail: email.trim().toLowerCase(),
            signupBanner: 'Account created! Sign in with your new credentials.',
          },
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Could not create account. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-7xl mx-auto px-6 lg:px-12 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary-container animate-pulse" />
            <span className="text-[10px] font-semibold text-outline tracking-wider uppercase">
              Spatial Engine v3.4 • Neural Splatting Ready
            </span>
          </div>
          <div className="flex items-center gap-6 text-outline">
            <span className="text-[10px] font-semibold uppercase tracking-widest hidden sm:inline-block">
              Atelier Access Pass
            </span>
            <span className="text-[10px] text-primary-deep font-semibold">01 / ENROLLMENT</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Left Column: Immersive Showcase */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="relative rounded-xl overflow-hidden bg-surface-container-high shadow-xl group h-[480px] sm:h-[520px]">
              <SafeImage
                src={STITCH_IMAGES.signupShowcase}
                alt="Sun-drenched Scandinavian living room interior in 3D"
                className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.015]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-on-surface/80 via-on-surface/20 to-transparent pointer-events-none" />

              <div className="absolute top-6 left-6 flex items-center gap-2 bg-surface/90 backdrop-blur-xl px-4 py-1.5 rounded-full shadow-md">
                <span className="material-symbols-outlined text-primary-deep text-[18px]">
                  view_in_ar
                </span>
                <span className="text-xs text-on-surface font-medium">
                  Gaussian Splat Canvas #842
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary-deep" />
                <span className="text-[10px] font-semibold text-tertiary-deep uppercase">
                  60 FPS Real-time
                </span>
              </div>

              <div className="hidden sm:flex absolute top-28 right-8 bg-surface-container-lowest/90 backdrop-blur-md px-4 py-2.5 rounded-lg shadow-lg items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
                  <span className="material-symbols-outlined text-[14px]">chair</span>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-outline uppercase tracking-wider">
                    Spatial Layer
                  </p>
                  <p className="text-xs text-on-surface font-medium">
                    Interactive Furniture Swapping
                  </p>
                </div>
              </div>

              <div className="hidden sm:flex absolute top-64 left-8 bg-surface-container-lowest/90 backdrop-blur-md px-4 py-2.5 rounded-lg shadow-lg items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-primary-fixed flex items-center justify-center text-primary-deep">
                  <span className="material-symbols-outlined text-[14px]">wb_sunny</span>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-outline uppercase tracking-wider">
                    Lighting Mode
                  </p>
                  <p className="text-xs text-on-surface font-medium">
                    True-to-Life Daylight Calibration
                  </p>
                </div>
              </div>

              <div className="hidden sm:flex absolute bottom-24 right-10 bg-surface-container-lowest/95 backdrop-blur-md px-4 py-2 rounded-lg shadow-lg items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[20px]">
                  auto_awesome
                </span>
                <span className="text-xs text-on-surface font-semibold">
                  Instant 3D Gaussian Splats
                </span>
              </div>

              <div className="absolute bottom-5 inset-x-6 flex items-center justify-between bg-surface-container-lowest/85 backdrop-blur-xl p-2.5 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-on-surface">
                    <span className="material-symbols-outlined text-[18px]">360</span>
                  </span>
                  <span className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-on-surface">
                    <span className="material-symbols-outlined text-[18px]">straighten</span>
                  </span>
                  <span className="text-xs text-outline px-1">Orbit • 1:1 Scale verified</span>
                </div>
                <div className="flex items-center gap-1.5 pr-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                  <span className="text-[11px] text-on-surface font-medium">
                    Natural Warm Umber
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-surface-container-low shadow-sm flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary-deep shrink-0">
                  <span className="material-symbols-outlined text-[18px]">videocam</span>
                </div>
                <div>
                  <h4 className="text-sm text-on-surface font-semibold">4K Phone Video to 3D</h4>
                  <p className="text-xs text-outline mt-0.5">
                    Simply walk your room with any modern smartphone.
                  </p>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-surface-container-low shadow-sm flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-secondary shrink-0">
                  <span className="material-symbols-outlined text-[18px]">light_mode</span>
                </div>
                <div>
                  <h4 className="text-sm text-on-surface font-semibold">Real-world Scale</h4>
                  <p className="text-xs text-outline mt-0.5">
                    Calibrated millimeter accuracy and natural shadows.
                  </p>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-surface-container-low shadow-sm flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-tertiary-deep shrink-0">
                  <span className="material-symbols-outlined text-[18px]">share_windows</span>
                </div>
                <div>
                  <h4 className="text-sm text-on-surface font-semibold">Instant Client Sharing</h4>
                  <p className="text-xs text-outline mt-0.5">
                    Zero downloads. Clients explore in standard browsers.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 rounded-xl bg-surface-container shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-secondary-fixed flex items-center justify-center text-secondary shrink-0 shadow-inner">
                  <span className="material-symbols-outlined text-[24px]">verified</span>
                </div>
                <div>
                  <p className="font-headline text-lg text-on-surface italic">
                    Start with 3 free room captures
                  </p>
                  <p className="text-xs text-outline mt-0.5">
                    No LiDAR or specialized hardware needed — just phone video.
                  </p>
                </div>
              </div>
              <div className="flex items-center -space-x-2 shrink-0">
                <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface text-[10px] font-semibold shadow-sm ring-2 ring-surface">
                  ER
                </div>
                <div className="w-8 h-8 rounded-full bg-primary-fixed flex items-center justify-center text-primary-deep text-[10px] font-semibold shadow-sm ring-2 ring-surface">
                  MK
                </div>
                <div className="w-8 h-8 rounded-full bg-tertiary-fixed flex items-center justify-center text-tertiary-deep text-[10px] font-semibold shadow-sm ring-2 ring-surface">
                  SL
                </div>
                <div className="w-8 h-8 rounded-full bg-surface-dim flex items-center justify-center text-on-surface text-[10px] font-semibold shadow-sm ring-2 ring-surface">
                  +14k
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Sign-Up Form */}
          <div className="lg:col-span-5 flex flex-col">
            <div className="bg-surface-container-lowest p-6 sm:p-10 rounded-xl shadow-xl border border-border-sand/60">
              <div className="flex items-center p-1 bg-surface-container-high rounded-lg mb-6">
                <div className="flex-1 py-1.5 text-center font-semibold text-xs rounded-md bg-surface-container-lowest text-primary-deep shadow-sm">
                  Create Account
                </div>
                <Link
                  to="/login"
                  className="flex-1 py-1.5 text-center font-semibold text-xs rounded-md text-outline hover:text-on-surface transition-all"
                >
                  Sign In
                </Link>
              </div>

              <div className="mb-6">
                <h1 className="font-headline text-3xl text-on-surface">
                  Begin creating spatial rooms
                </h1>
                <p className="text-xs text-outline mt-1 leading-relaxed">
                  Join over 14,000 interior designers, stylists, and homeowners capturing real
                  spaces.
                </p>
              </div>

              {demoMode && (
                <>
                  <div className="grid grid-cols-2 gap-2.5 mb-4">
                    <button
                      type="button"
                      onClick={() => {
                        signInWithDemoProvider('Google');
                        showToast('Enrolled via Google Demo Pass', 'success');
                        navigate('/spaces');
                      }}
                      className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all shadow-sm"
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
                      <span>Google (Demo)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        signInWithDemoProvider('Apple');
                        showToast('Enrolled via Apple Demo Pass', 'success');
                        navigate('/spaces');
                      }}
                      className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all shadow-sm"
                    >
                      <svg className="w-4 h-4 fill-current text-on-surface" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.76 1.06-1.81.94-2.87-.91.04-2.02.61-2.67 1.37-.58.67-1.09 1.74-.95 2.78 1.02.08 2.05-.52 2.68-1.28z" />
                      </svg>
                      <span>Apple (Demo)</span>
                    </button>
                  </div>

                  <div className="relative flex items-center justify-center mb-4">
                    <div className="w-full h-px bg-surface-container-high" />
                    <span className="absolute px-2 bg-surface-container-lowest text-[10px] font-semibold text-outline uppercase tracking-wider">
                      or sign up with email
                    </span>
                  </div>
                </>
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

              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-1 text-left">
                  <label className="text-xs text-on-surface font-semibold" htmlFor="signup-name">
                    Full Name
                  </label>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined text-[18px] text-outline absolute left-3 pointer-events-none">
                      badge
                    </span>
                    <input
                      id="signup-name"
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Elena Rostova"
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-surface-container-low text-on-surface text-xs focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all placeholder:text-outline/50"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1 text-left">
                  <label className="text-xs text-on-surface font-semibold" htmlFor="signup-email">
                    Email Address
                  </label>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined text-[18px] text-outline absolute left-3 pointer-events-none">
                      mail
                    </span>
                    <input
                      id="signup-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. elena@atelierdesign.com"
                      className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-surface-container-low text-on-surface text-xs focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all placeholder:text-outline/50"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1 text-left">
                  <div className="flex items-center justify-between">
                    <label
                      className="text-xs text-on-surface font-semibold"
                      htmlFor="signup-password"
                    >
                      Password
                    </label>
                    <span className="text-[11px] text-tertiary-deep font-semibold">
                      {strength.label}
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined text-[18px] text-outline absolute left-3 pointer-events-none">
                      lock
                    </span>
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 chars (letter + number)"
                      className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-surface-container-low text-on-surface text-xs focus:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all placeholder:text-outline/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label="Toggle password visibility"
                      className="absolute right-3 text-outline hover:text-on-surface transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                    {[1, 2, 3, 4].map((bar) => (
                      <div
                        key={bar}
                        className={`h-1 rounded-full transition-colors ${
                          bar <= strength.score ? strength.color : 'bg-surface-container-high'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 text-left">
                  <span className="text-xs text-on-surface font-semibold">
                    Your Primary Practice
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {ROLES.map((role) => {
                      const active = selectedRole === role;
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setSelectedRole(role)}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                            active
                              ? 'bg-primary-deep text-on-primary shadow-sm'
                              : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
                          }`}
                        >
                          {role}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-start gap-2 text-left pt-1">
                  <input
                    id="signup-terms"
                    type="checkbox"
                    checked={agreedTerms}
                    onChange={(e) => setAgreedTerms(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-primary focus:ring-primary/30 accent-primary"
                  />
                  <label className="text-xs text-outline leading-tight" htmlFor="signup-terms">
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => setInfoTopic('photogrammetry')}
                      className="text-on-surface underline hover:text-primary-deep transition-colors"
                    >
                      Terms of Service
                    </button>{' '}
                    &amp;{' '}
                    <button
                      type="button"
                      onClick={() => setInfoTopic('privacy')}
                      className="text-on-surface underline hover:text-primary-deep transition-colors"
                    >
                      Privacy Policy
                    </button>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-2 py-3.5 px-6 rounded-md bg-primary-container-deep hover:bg-primary-deep text-on-primary text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(138,67,37,0.22)] hover:scale-[1.012] active:scale-[0.99] transition-all duration-300 disabled:opacity-60"
                >
                  <span>
                    {submitting
                      ? 'Creating Atelier...'
                      : 'Create Atelier Account & Start Scanning'}
                  </span>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </button>
              </form>

              <div className="mt-4 text-center pt-2">
                <span className="text-xs text-outline">Already have an account?</span>
                <Link
                  to="/login"
                  className="text-xs text-primary-deep font-semibold hover:underline ml-1"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 flex flex-wrap items-center justify-between gap-4 text-outline">
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-wider text-on-surface-muted font-semibold">
              Standard of spatial fidelity
            </span>
            <span className="text-outline-variant">•</span>
            <span className="text-xs">
              Compatible with iOS 17+, Android Chrome, Safari &amp; VisionOS
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px] text-tertiary-deep">lock</span>
              End-to-end encrypted scans
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px] text-secondary">
                cloud_done
              </span>
              Instant cloud generation
            </span>
          </div>
        </div>
      </div>

      <InfoTopicModal topic={infoTopic} onClose={() => setInfoTopic(null)} />
    </AuthShell>
  );
};
