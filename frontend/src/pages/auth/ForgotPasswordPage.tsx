import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { SafeImage } from '../../components/common/SafeImage';
import { InfoModalTopic, InfoTopicModal } from '../../components/modals/InfoModals';
import { useAuth } from '../../context/AuthContext';
import { useProjects } from '../../context/ProjectsContext';
import { useToast } from '../../context/ToastContext';
import { STITCH_IMAGES } from '../../data/mockData';

export const ForgotPasswordPage: React.FC = () => {
  const { demoMode, requestPasswordReset, signInWithDemoProvider } = useAuth();
  const { projects } = useProjects();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState(demoMode ? 'elena.rostova@ateliernord.com' : '');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [devResetToken, setDevResetToken] = useState<string | undefined>(undefined);
  const [resentRecently, setResentRecently] = useState(false);
  const [infoTopic, setInfoTopic] = useState<InfoModalTopic>(null);
  const resendTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resendTimerRef.current !== null) {
        window.clearTimeout(resendTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      const devToken = await requestPasswordReset(email);
      setDevResetToken(devToken);
      setSubmitted(true);
      showToast(`Recovery instructions issued for ${email}`, 'success');
    } catch (err) {
      const msg =
        err instanceof Error && err.message ? err.message : 'Unable to send reset link.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResentRecently(true);
    try {
      const devToken = await requestPasswordReset(email);
      if (devToken) setDevResetToken(devToken);
      showToast('Fresh recovery key dispatched', 'info');
    } catch {
      showToast('Unable to resend recovery link right now.', 'error');
    }
    if (resendTimerRef.current !== null) {
      window.clearTimeout(resendTimerRef.current);
    }
    resendTimerRef.current = window.setTimeout(() => setResentRecently(false), 3000);
  };

  return (
    <AuthShell>
      <div className="relative w-full max-w-7xl mx-auto px-6 lg:px-12 py-10 lg:py-16">
        <div className="absolute top-12 left-1/4 w-96 h-96 rounded-full bg-secondary-fixed/20 blur-3xl -z-10 pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-80 h-80 rounded-full bg-surface-tint/10 blur-3xl -z-10 pointer-events-none" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Panel */}
          <aside className="lg:col-span-5 flex flex-col gap-6 order-2 lg:order-1">
            <div className="relative overflow-hidden rounded-xl bg-surface-container shadow-xl">
              <div className="w-full h-[400px] relative flex flex-col justify-between p-6">
                <SafeImage
                  src={STITCH_IMAGES.forgotShowcase}
                  alt="Sun-drenched architectural interior with boucle lounge chair"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-inverse-surface/85 via-inverse-surface/25 to-transparent" />
                <div className="relative z-10 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-lowest/85 backdrop-blur-md text-on-surface text-[10px] font-semibold uppercase tracking-wider shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-tertiary-deep animate-pulse" />
                    Spatial Archive Active
                  </span>
                  <span className="w-8 h-8 rounded-full bg-surface-container-lowest/85 backdrop-blur-md flex items-center justify-center text-on-surface shadow-sm">
                    <span className="material-symbols-outlined text-[16px]">lock</span>
                  </span>
                </div>

                <div className="relative z-10 text-inverse-on-surface space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-secondary-fixed tracking-widest uppercase">
                      AuraSpace Vault
                    </span>
                    <span className="text-outline-variant text-xs">•</span>
                    <span className="text-xs text-surface-variant/90">256-Bit Spatial Guard</span>
                  </div>
                  <p className="font-headline text-xl text-inverse-on-surface leading-snug">
                    Your neural scans, furniture restylings &amp; light studies remain undisturbed.
                  </p>
                  <div className="pt-2 flex items-center gap-3">
                    <div className="flex -space-x-2">
                      <div className="w-7 h-7 rounded-full bg-secondary-fixed-dim/90 flex items-center justify-center text-on-secondary-fixed text-[10px] font-semibold shadow-sm">
                        GS
                      </div>
                      <div className="w-7 h-7 rounded-full bg-tertiary-fixed-dim/90 flex items-center justify-center text-on-tertiary-fixed text-[10px] font-semibold shadow-sm">
                        3D
                      </div>
                      <div className="w-7 h-7 rounded-full bg-surface-container-high/90 flex items-center justify-center text-primary-deep text-[10px] font-semibold shadow-sm">
                        HQ
                      </div>
                    </div>
                    <span className="text-xs text-surface-variant/90">
                      All {projects.length} workspace rooms sync instantly upon recovery
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-surface-container-lowest p-6 shadow-sm space-y-5 border border-border-sand/60">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-outline uppercase tracking-wider">
                  Recovery Protocol
                </span>
                <span className="text-[10px] text-tertiary-deep font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">shield_with_heart</span>
                  Zero Data Loss
                </span>
              </div>
              <div className="space-y-4">
                {[
                  {
                    num: '01',
                    title: 'Check your studio inbox',
                    desc: 'We send a transient cryptographic passkey link within moments.',
                  },
                  {
                    num: '02',
                    title: 'Tap the secure link',
                    desc: 'One-click authenticated verification valid for 30 peaceful minutes.',
                  },
                  {
                    num: '03',
                    title: 'Choose new key & resume',
                    desc: 'Instantly rejoin your 3D Gaussian splat viewpoints right where you left.',
                  },
                ].map((step) => (
                  <div key={step.num} className="flex items-start gap-3.5 group">
                    <div className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center text-primary-deep text-[11px] font-semibold shrink-0 group-hover:bg-primary-fixed transition-colors">
                      {step.num}
                    </div>
                    <div>
                      <p className="text-sm text-on-surface font-semibold">{step.title}</p>
                      <p className="text-xs text-on-surface-muted">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setInfoTopic('concierge')}
                  className="w-full flex items-center justify-between p-3.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[18px] text-primary-deep">
                      support_agent
                    </span>
                    <span className="text-xs font-medium">Need immediate assistance?</span>
                  </div>
                  <span className="text-[11px] font-semibold text-primary-deep flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    Atelier Concierge
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </span>
                </button>
              </div>
            </div>
          </aside>

          {/* Right Panel: Form */}
          <section className="lg:col-span-7 flex flex-col order-1 lg:order-2">
            <div className="rounded-xl bg-surface-container-lowest p-8 lg:p-12 shadow-xl relative overflow-hidden border border-border-sand/60">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary-deep via-secondary-container to-surface-tint" />

              <div className="flex items-center gap-2 mb-4">
                <span className="px-2.5 py-1 rounded-md bg-surface-container text-on-surface-muted text-[10px] tracking-wider uppercase font-semibold">
                  Account Recovery
                </span>
                <span className="text-outline-variant text-xs">•</span>
                <span className="text-[10px] font-semibold text-outline tracking-wider uppercase">
                  Secure Access
                </span>
              </div>

              <h1 className="font-headline text-4xl lg:text-5xl text-on-surface tracking-tight leading-tight">
                Forgotten your key to the atelier?
              </h1>
              <p className="text-base text-on-surface-muted mt-3 max-w-xl leading-relaxed">
                Enter the email address registered with your AuraSpace account. We will dispatch a
                private, encrypted link to redefine your credentials and immediately unfreeze your
                3D spatial canvas.
              </p>

              {!submitted ? (
                <div className="mt-8 space-y-6">
                  {error && (
                    <div
                      role="alert"
                      className="rounded-lg bg-error-container text-on-error-container px-3.5 py-2.5 text-xs font-medium flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[16px]">error</span>
                      <span>{error}</span>
                    </div>
                  )}
                  <form className="space-y-6" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                      <label
                        className="block text-xs font-semibold text-on-surface"
                        htmlFor="recovery-email"
                      >
                        Work or Studio Email
                      </label>
                      <div className="relative flex items-center">
                        <span className="material-symbols-outlined absolute left-4 text-[20px] text-outline pointer-events-none">
                          mail
                        </span>
                        <input
                          id="recovery-email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="e.g. designer@studio.com"
                          className="w-full pl-12 pr-4 py-3.5 rounded-lg bg-surface-container-low text-on-surface placeholder:text-outline text-sm focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary-deep transition-all"
                        />
                      </div>
                      <div className="flex items-center justify-between px-1 pt-1">
                        <span className="text-xs text-outline">
                          A single link will be generated for security.
                        </span>
                        <span className="text-[11px] text-tertiary-deep flex items-center gap-1 font-semibold">
                          <span className="material-symbols-outlined text-[13px]">
                            verified_user
                          </span>
                          TLS 1.3
                        </span>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-4 px-6 rounded-lg bg-primary-container-deep text-on-primary hover:bg-primary-deep text-sm font-semibold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all duration-200 active:scale-[0.99] group disabled:opacity-60"
                    >
                      <span>{submitting ? 'Sending Reset Link...' : 'Send Reset Link'}</span>
                      <span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">
                        arrow_forward
                      </span>
                    </button>
                  </form>

                  <div className="rounded-lg bg-surface-container-low p-4 flex items-start gap-3">
                    <span className="material-symbols-outlined text-primary-deep text-[20px] shrink-0 mt-0.5">
                      schedule
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm text-on-surface font-semibold">
                        30-Minute Security Window
                      </p>
                      <p className="text-xs text-on-surface-muted leading-relaxed">
                        Encrypted tokens automatically expire to safeguard private client renders.
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <Link
                      to="/login"
                      className="inline-flex items-center gap-2 text-primary-deep hover:text-surface-tint text-xs font-semibold transition-colors group"
                    >
                      <span className="material-symbols-outlined text-[18px] group-hover:-translate-x-1 transition-transform">
                        arrow_back
                      </span>
                      Remembered your password? Return to Sign In
                    </Link>
                    {demoMode && (
                      <button
                        type="button"
                        onClick={() => {
                          signInWithDemoProvider('Studio SAML');
                          showToast('Demo SAML session verified', 'success');
                          navigate('/spaces');
                        }}
                        className="text-xs text-outline hover:text-primary-deep underline transition-colors"
                      >
                        Demo SSO / Studio SAML
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-8 space-y-6">
                  <div className="rounded-xl bg-surface-container p-6 space-y-4">
                    <div className="w-12 h-12 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
                      <span className="material-symbols-outlined text-[24px]">mark_email_read</span>
                    </div>
                    <div className="space-y-1">
                      <h2 className="font-headline text-2xl text-on-surface">Dispatch confirmed</h2>
                      <p className="text-sm text-on-surface-muted">
                        We have dispatched an encrypted recovery key to{' '}
                        <span className="font-semibold text-on-surface">{email}</span>.
                      </p>
                    </div>
                    <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-on-surface-muted">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full bg-secondary ${
                            resentRecently ? '' : 'animate-ping'
                          }`}
                        />
                        {resentRecently
                          ? 'Fresh link sent just now'
                          : 'Link active for 29:59 minutes'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleResend()}
                        className="text-primary-deep hover:text-surface-tint font-semibold text-left"
                      >
                        Resend another link
                      </button>
                    </div>
                    {devResetToken && (
                      <div className="pt-2 border-t border-outline-variant/40 text-xs flex flex-col gap-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-deep">
                          Dev Reset Shortcut
                        </span>
                        <Link
                          to={`/set-new-password?token=${encodeURIComponent(devResetToken)}`}
                          className="inline-flex items-center gap-1.5 text-primary-deep font-semibold hover:underline break-all"
                        >
                          <span className="material-symbols-outlined text-[15px]">vpn_key</span>
                          <span>Open Reset Link with Issued Token →</span>
                        </Link>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                    <Link
                      to={
                        devResetToken
                          ? `/set-new-password?token=${encodeURIComponent(devResetToken)}`
                          : '/set-new-password'
                      }
                      className="w-full sm:w-auto py-3.5 px-6 rounded-lg bg-primary-deep hover:bg-primary-container-deep text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
                    >
                      <span>Proceed to Set New Password</span>
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </Link>
                    <Link
                      to="/login"
                      className="w-full sm:w-auto py-3.5 px-6 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">keyboard_return</span>
                      Return to Login Canvas
                    </Link>
                    <button
                      type="button"
                      onClick={() => setSubmitted(false)}
                      className="text-outline hover:text-on-surface text-xs font-semibold transition-colors"
                    >
                      Re-enter email
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-10 pt-6 flex flex-wrap items-center justify-between gap-4 text-outline text-[11px] font-semibold">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">apartment</span>
                    Spatial Cloud ID: #AS-7029-EU
                  </span>
                  <span>•</span>
                  <span>Gaussian Scene Buffer Ready</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-secondary" />
                  <span>Atelier Node Amsterdam / Online</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <InfoTopicModal topic={infoTopic} onClose={() => setInfoTopic(null)} />
    </AuthShell>
  );
};
