import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { SafeImage } from '../../components/common/SafeImage';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { STITCH_IMAGES } from '../../data/mockData';

export const SetNewPasswordPage: React.FC = () => {
  const { demoMode, completePasswordReset } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [resetToken, setResetToken] = useState(searchParams.get('token') || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const checks = useMemo(() => {
    const hasLength = newPassword.length >= 8;
    const hasMix = /[A-Za-z]/.test(newPassword) && /[0-9]/.test(newPassword);
    const hasCase = /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword);
    const hasExtra = newPassword.length >= 12 || /[^A-Za-z0-9]/.test(newPassword);
    const score = [hasLength, hasMix, hasCase, hasExtra].filter(Boolean).length;
    const labels = ['Too short', 'Fair', 'Good', 'Strong', 'Linen strong'];
    const passwordsMatch = Boolean(newPassword && confirmPassword && newPassword === confirmPassword);
    return {
      hasLength,
      hasMix,
      score,
      strengthLabel: newPassword ? labels[score] : 'Enter new key',
      passwordsMatch,
    };
  }, [newPassword, confirmPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!demoMode && !resetToken.trim()) {
      setFormError('Please enter your password reset token.');
      return;
    }
    if (!checks.hasLength) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }
    if (!checks.hasMix) {
      setFormError('Password must include both letters and numbers.');
      return;
    }
    if (!checks.passwordsMatch) {
      setFormError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await completePasswordReset(newPassword, resetToken);
      showToast('Atelier key updated securely', 'success');
      navigate('/password-reset-success');
    } catch (err) {
      const msg =
        err instanceof Error && err.message ? err.message : 'Unable to reset password.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <section className="w-full max-w-7xl mx-auto px-6 lg:px-12 py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Showcase Panel */}
          <div className="lg:col-span-6 flex flex-col gap-6">
            <div className="inline-flex items-center gap-2 self-start px-3.5 py-1.5 rounded-full bg-tertiary-fixed/70 text-on-tertiary-fixed-variant shadow-sm">
              <span className="w-2 h-2 rounded-full bg-tertiary-deep animate-pulse" />
              <span className="material-symbols-outlined text-[15px] icon-filled">
                verified_user
              </span>
              <span className="text-[10px] font-semibold tracking-wider uppercase">
                ENCRYPTED RECOVERY SESSION
              </span>
            </div>

            <div className="relative w-full h-80 sm:h-96 rounded-xl overflow-hidden shadow-xl bg-surface-container-high group">
              <SafeImage
                src={STITCH_IMAGES.setPwdShowcase}
                alt="Sunlit architectural interior studio"
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-on-surface/80 via-on-surface/25 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 flex flex-col gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-secondary-fixed">
                  AURASPACE VAULT • 256-Bit Spatial Guard
                </span>
                <h2 className="font-headline text-2xl sm:text-3xl text-white leading-snug">
                  Your 3D rooms &amp; furniture studies are ready to resume.
                </h2>
              </div>
            </div>

            <div className="w-full rounded-xl bg-surface-container-low p-6 sm:p-7 shadow-sm flex flex-col gap-4 border border-border-sand/60">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-outline">
                  PASSWORD GUIDELINES
                </span>
                <span className="text-[10px] font-semibold text-primary-deep">
                  Atelier Standard
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                <div className="flex items-center gap-2 text-on-surface-muted">
                  <span
                    className={`material-symbols-outlined text-[18px] icon-filled ${
                      checks.hasLength ? 'text-tertiary-deep' : 'text-outline-variant'
                    }`}
                  >
                    check_circle
                  </span>
                  <span className="text-xs">At least 8 characters</span>
                </div>
                <div className="flex items-center gap-2 text-on-surface-muted">
                  <span
                    className={`material-symbols-outlined text-[18px] icon-filled ${
                      checks.hasMix ? 'text-tertiary-deep' : 'text-outline-variant'
                    }`}
                  >
                    check_circle
                  </span>
                  <span className="text-xs">Mix of letters &amp; numbers</span>
                </div>
                <div className="flex items-center gap-2 text-on-surface-muted">
                  <span className="material-symbols-outlined text-[18px] text-primary-deep icon-filled">
                    check_circle
                  </span>
                  <span className="text-xs">Unique to your atelier</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Form Card */}
          <div className="lg:col-span-6 lg:mt-4">
            <div className="w-full rounded-xl bg-surface-container-lowest p-8 sm:p-10 shadow-xl flex flex-col gap-6 border border-border-sand/60">
              <div className="flex flex-col gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-primary-deep">
                  CREDENTIAL UPDATE • STEP 2 OF 2
                </span>
                <h1 className="font-headline text-3xl sm:text-4xl text-on-surface">
                  Create a new atelier key
                </h1>
                <p className="text-sm text-on-surface-muted leading-relaxed">
                  Choose a strong password to secure your AuraSpace account and immediately return
                  to your 3D spatial canvas.
                </p>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="rounded-lg bg-error-container text-on-error-container px-3.5 py-2.5 text-xs font-medium flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  <span>{formError}</span>
                </div>
              )}

              <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
                {!demoMode && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-on-surface" htmlFor="reset-token">
                      Password Reset Token
                    </label>
                    <input
                      id="reset-token"
                      type="text"
                      value={resetToken}
                      onChange={(e) => {
                        setResetToken(e.target.value);
                        if (formError) setFormError('');
                      }}
                      placeholder="Paste reset token from recovery email"
                      className="w-full px-4 py-3 rounded-lg bg-surface-container-low text-on-surface text-xs font-mono placeholder:text-outline/60 focus:outline-none focus:bg-surface-container transition-colors"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-on-surface" htmlFor="new-password">
                    New Password
                  </label>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3.5 text-[20px] text-outline pointer-events-none">
                      lock
                    </span>
                    <input
                      id="new-password"
                      type={showNew ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (formError) setFormError('');
                      }}
                      placeholder="At least 8 chars with letters & numbers"
                      className="w-full pl-11 pr-12 py-3.5 rounded-lg bg-surface-container-low text-on-surface text-sm placeholder:text-outline/60 focus:outline-none focus:bg-surface-container transition-colors"
                    />
                    <button
                      type="button"
                      aria-label="Toggle new password visibility"
                      onClick={() => setShowNew((v) => !v)}
                      className="absolute right-3.5 text-outline hover:text-on-surface transition-colors p-1"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showNew ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex-1 grid grid-cols-4 gap-1.5">
                      {[1, 2, 3, 4].map((seg) => (
                        <div
                          key={seg}
                          className={`h-1.5 rounded-full transition-colors duration-300 ${
                            seg <= checks.score ? 'bg-tertiary-deep' : 'bg-surface-container-highest'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] font-semibold text-tertiary-deep">
                      {checks.strengthLabel}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    className="text-xs font-semibold text-on-surface"
                    htmlFor="confirm-password"
                  >
                    Confirm New Password
                  </label>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3.5 text-[20px] text-outline pointer-events-none">
                      lock
                    </span>
                    <input
                      id="confirm-password"
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (formError) setFormError('');
                      }}
                      placeholder="Re-enter your new password"
                      className="w-full pl-11 pr-12 py-3.5 rounded-lg bg-surface-container-low text-on-surface text-sm placeholder:text-outline/60 focus:outline-none focus:bg-surface-container transition-colors"
                    />
                    <button
                      type="button"
                      aria-label="Toggle confirm password visibility"
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-3.5 text-outline hover:text-on-surface transition-colors p-1"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showConfirm ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>

                  {confirmPassword.length > 0 && (
                    <div
                      className={`flex items-center gap-1.5 pt-0.5 ${
                        checks.passwordsMatch ? 'text-tertiary-deep' : 'text-error'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px] icon-filled">
                        {checks.passwordsMatch ? 'check_circle' : 'error'}
                      </span>
                      <span className="text-[11px] font-semibold">
                        {checks.passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                      </span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-2 py-4 px-6 rounded-lg bg-primary-deep hover:bg-primary-container-deep text-on-primary text-sm font-semibold shadow-md hover:shadow-lg transition-all duration-200 active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <span>{submitting ? 'Updating Password...' : 'Update Password & Continue'}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </form>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                <Link
                  to="/login"
                  className="text-xs font-semibold text-on-surface-muted hover:text-primary-deep transition-colors inline-flex items-center gap-1.5"
                >
                  <span aria-hidden="true">←</span>
                  <span>Back to Sign In</span>
                </Link>
                <div className="flex items-center gap-2 text-outline">
                  <span className="material-symbols-outlined text-[15px]">encrypted</span>
                  <span className="text-[11px] font-semibold">Session verified • TLS 1.3</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AuthShell>
  );
};
