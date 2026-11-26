import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';
import { SafeImage } from '../../components/common/SafeImage';
import { InfoModalTopic, InfoTopicModal } from '../../components/modals/InfoModals';
import { useAuth } from '../../context/AuthContext';
import { useProjects } from '../../context/ProjectsContext';
import { useToast } from '../../context/ToastContext';
import { STITCH_IMAGES } from '../../data/mockData';

export const PasswordResetSuccessPage: React.FC = () => {
  const { demoMode, user, recoveryEmail, signOut } = useAuth();
  const { projects } = useProjects();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const targetPath = demoMode ? '/spaces' : '/login';

  const [secondsLeft, setSecondsLeft] = useState(8);
  const [isPaused, setIsPaused] = useState(false);
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [infoTopic, setInfoTopic] = useState<InfoModalTopic>(null);
  const receiptTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (receiptTimerRef.current !== null) {
        window.clearTimeout(receiptTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isPaused) return;
    if (secondsLeft <= 0) {
      navigate(targetPath);
      return;
    }
    const timer = window.setTimeout(() => {
      setSecondsLeft((s) => s - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, isPaused, navigate, targetPath]);

  const handleSaveReceipt = () => {
    const content = [
      'AuraSpace Atelier — Security Key Receipt',
      `Profile: ${recoveryEmail || user.email}`,
      `Timestamp: ${new Date().toISOString()}`,
      'Standard: TLS 1.3 Strict / 256-bit Spatial Guard',
      'Status: Credentials Refreshed',
    ].join('\n');

    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'auraspace-security-key.txt';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Ignore if download blocked
    }
    setReceiptSaved(true);
    showToast('Security key receipt saved', 'success');
    if (receiptTimerRef.current !== null) {
      window.clearTimeout(receiptTimerRef.current);
    }
    receiptTimerRef.current = window.setTimeout(() => setReceiptSaved(false), 2400);
  };

  const restyleCount = projects.filter((p) => p.hasRestyle).length;

  return (
    <AuthShell>
      <div className="max-w-7xl mx-auto w-full px-6 lg:px-12 py-8 lg:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          {/* Left Showcase Panel */}
          <div className="lg:col-span-5 flex flex-col justify-between rounded-xl bg-surface-container-low p-7 lg:p-9 shadow-sm relative overflow-hidden border border-border-sand/60">
            <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-gradient-to-br from-secondary-container/20 via-primary-fixed/20 to-transparent blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-gradient-to-tr from-surface-tint/10 via-secondary-fixed/20 to-transparent blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col gap-6">
              <div className="inline-flex items-center gap-2 self-start px-3.5 py-1.5 rounded-full bg-tertiary-container text-tertiary-deep shadow-sm">
                <span className="w-2 h-2 rounded-full bg-tertiary-deep animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">
                  Session Secured • Credentials Refreshed
                </span>
              </div>

              <div className="relative group rounded-lg overflow-hidden shadow-md bg-surface-container h-56 lg:h-64">
                <SafeImage
                  src={STITCH_IMAGES.resetSuccessShowcase}
                  alt="Haussmann Salon 3DGS living room interior"
                  className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
                <div className="absolute inset-x-3 bottom-3 p-3 rounded-lg bg-surface/85 backdrop-blur-md shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-md bg-primary-container-deep text-on-primary flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[16px]">view_in_ar</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-on-surface truncate">
                        Haussmann Salon 3DGS
                      </p>
                      <p className="text-[11px] text-outline truncate">
                        Neural splat • 4.8M Gaussians synced
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-muted font-semibold">
                    Active
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-headline text-lg text-on-surface">Vault Synchronization</span>
                  <span className="text-[10px] uppercase text-secondary font-semibold">
                    Zero Data Disruption
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="p-3 rounded-lg bg-surface-container flex flex-col items-center text-center shadow-sm">
                    <span className="font-headline text-xl text-primary-deep">
                      {projects.length}
                    </span>
                    <span className="text-[10px] text-outline mt-0.5">Active Spaces</span>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-container flex flex-col items-center text-center shadow-sm">
                    <span className="font-headline text-xl text-secondary">{restyleCount}</span>
                    <span className="text-[10px] text-outline mt-0.5">Custom Restyles</span>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-container flex flex-col items-center text-center shadow-sm">
                    <span className="font-headline text-xl text-tertiary-deep">100%</span>
                    <span className="text-[10px] text-outline mt-0.5">Assets Intact</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-6 bg-surface-container-highest/60 rounded-lg p-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-secondary shrink-0 shadow-sm">
                <span className="material-symbols-outlined text-[18px]">passkey</span>
              </div>
              <div className="flex-1">
                <p className="text-xs text-on-surface font-semibold">
                  Tip: Biometric Passkey Ready
                </p>
                <p className="text-xs text-on-surface-muted mt-0.5">
                  Enable Touch ID or Face ID in Studio Preferences for seamless zero-friction
                  spatial sign-in.
                </p>
              </div>
            </div>
          </div>

          {/* Right Main Recovery Card */}
          <div className="lg:col-span-7 flex flex-col justify-between rounded-xl bg-surface-container-lowest p-7 lg:p-12 shadow-md relative border border-border-sand/60">
            <div>
              <div className="flex items-center justify-between mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-high text-on-surface-muted">
                  <span className="material-symbols-outlined text-[15px] text-primary-deep">
                    check_circle
                  </span>
                  <span className="text-[10px] uppercase tracking-wider font-semibold">
                    Recovery Complete • Step 3 of 3
                  </span>
                </div>
                <span className="text-[10px] text-outline tracking-wider font-mono uppercase">
                  AUTH-SEC-2026
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 mb-6">
                <div className="relative flex items-center justify-center w-16 h-16 rounded-xl bg-primary-fixed text-primary-deep shrink-0 shadow-sm">
                  <div className="absolute inset-0 rounded-xl bg-primary-fixed animate-ping opacity-25" />
                  <span className="material-symbols-outlined text-[32px] icon-filled">
                    verified_user
                  </span>
                </div>
                <div className="flex flex-col">
                  <h1 className="font-headline text-3xl sm:text-4xl text-on-surface">
                    Your atelier key is updated.
                  </h1>
                  <p className="text-xs text-secondary font-semibold uppercase tracking-wider mt-1">
                    Spatial Identity Refreshed
                  </p>
                </div>
              </div>

              <p className="text-base text-on-surface-muted max-w-xl mb-8 leading-relaxed">
                Your master credentials have been securely stored and authenticated. All previous
                browser handshakes have been safely revoked, and your spatial renders are synced
                with end-to-end encryption.
              </p>

              <div className="rounded-xl bg-surface-container-low p-5 mb-8 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-outline font-semibold">
                      Verified Profile
                    </span>
                    <span className="text-xs text-on-surface font-semibold mt-1 truncate">
                      {recoveryEmail || user.email || 'Account Verified'}
                    </span>
                    <span className="text-xs text-on-surface-muted truncate">
                      Master Architect License
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-outline font-semibold">
                      Timestamp
                    </span>
                    <span className="text-xs text-on-surface font-semibold mt-1">
                      Just now • Today
                    </span>
                    <span className="text-xs text-on-surface-muted">Paris (UTC+1)</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-outline font-semibold">
                      Security Standard
                    </span>
                    <span className="text-xs text-tertiary-deep font-semibold mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">lock</span> TLS 1.3
                      Strict
                    </span>
                    <span className="text-xs text-on-surface-muted">256-bit Spatial Guard</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 mb-8">
                <Link
                  to={targetPath}
                  className="flex-1 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-lg bg-primary-deep text-on-primary font-semibold text-sm shadow-md hover:bg-surface-tint active:scale-[0.99] transition-all duration-200"
                >
                  <span>{demoMode ? 'Enter Atelier Studio' : 'Sign In with New Password'}</span>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </Link>
                <button
                  type="button"
                  onClick={handleSaveReceipt}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-lg bg-surface-container text-on-surface font-semibold text-sm hover:bg-surface-container-high transition-colors shadow-sm"
                >
                  <span className="material-symbols-outlined text-[18px] text-outline">
                    file_download
                  </span>
                  <span>{receiptSaved ? 'Key Saved to Vault ✓' : 'Download Security Key'}</span>
                </button>
              </div>

              <div className="p-4 rounded-lg bg-surface-container-low flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-on-surface-muted">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-secondary">
                      timelapse
                    </span>
                    <span className="text-xs">
                      {isPaused
                        ? 'Auto-redirect paused. Proceed when you are ready.'
                        : secondsLeft > 0
                          ? `Redirecting to ${demoMode ? 'Atelier Studio' : 'Sign In'} in ${secondsLeft} seconds...`
                          : 'Redirecting now...'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPaused((p) => !p)}
                    className="text-[11px] uppercase tracking-wider text-primary-deep hover:text-primary-container-deep font-semibold transition-colors"
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                </div>
                <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className="h-full bg-secondary-container transition-all duration-1000 ease-linear"
                    style={{ width: `${(secondsLeft / 8) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="pt-8 mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
              <p className="text-xs text-outline">Didn&apos;t initiate this credential update?</p>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsPaused(true);
                    signOut();
                    showToast('Session locked — please verify identity.', 'warning');
                    navigate('/login');
                  }}
                  className="text-[11px] uppercase tracking-wider text-error font-semibold hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">shield_person</span> Lock
                  Account Immediately
                </button>
                <span className="text-outline-variant">•</span>
                <button
                  type="button"
                  onClick={() => setInfoTopic('concierge')}
                  className="text-[11px] uppercase tracking-wider text-on-surface-muted font-semibold hover:text-primary-deep transition-colors"
                >
                  Concierge
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <InfoTopicModal topic={infoTopic} onClose={() => setInfoTopic(null)} />
    </AuthShell>
  );
};
