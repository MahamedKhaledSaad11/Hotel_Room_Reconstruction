import React, { useEffect, useRef, useState } from 'react';
import { AppHeader } from '../components/layout/AppHeader';
import { AppFooter } from '../components/layout/AppFooter';
import { SafeImage } from '../components/common/SafeImage';
import { AtelierModal, InfoModalTopic, InfoTopicModal } from '../components/modals/InfoModals';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectsContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';

type SettingsSection = 'all' | 'profile' | 'engine' | 'security' | 'notifications';

function downscaleAvatarToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('IMAGE_INVALID'));
      img.onload = () => {
        const maxDim = 256;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(typeof reader.result === 'string' ? reader.result : '');
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      } else {
        reject(new Error('EMPTY_RESULT'));
      }
    };
    reader.readAsDataURL(file);
  });
}

export const SettingsPage: React.FC = () => {
  const { user, settings, demoMode, sessionId, updateProfile, changePassword, updateSettings } =
    useAuth();
  const { projects } = useProjects();
  const { showToast } = useToast();

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const mountedRef = useRef(true);
  const [activeSection, setActiveSection] = useState<SettingsSection>('all');

  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [studioName, setStudioName] = useState(user.studioName);
  const [practiceFocus, setPracticeFocus] = useState(user.practiceFocus);
  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>(settings.unitSystem);
  const [autoDaylightSync, setAutoDaylightSync] = useState(settings.autoDaylightSync);

  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl);
  const [demoModeDraft, setDemoModeDraft] = useState<boolean>(demoMode);
  const [poseEstimator, setPoseEstimator] = useState<'GLOMAP' | 'VGGT'>(
    settings.defaultPoseEstimator
  );
  const [maxRes, setMaxRes] = useState<640 | 768 | 960>(settings.defaultMaxResolution);
  const [testingConn, setTestingConn] = useState(false);
  const [connStatus, setConnStatus] = useState<string | null>(null);

  const [notifyComplete, setNotifyComplete] = useState(settings.notifyReconstructionComplete);
  const [notifyClient, setNotifyClient] = useState(settings.notifyClientWalkthrough);
  const [biometricActive, setBiometricActive] = useState(settings.biometricPasskeyEnabled);
  const [twoFactorActive, setTwoFactorActive] = useState(settings.twoFactorEnabled);

  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [rotatedKeyToken, setRotatedKeyToken] = useState('');
  const [infoTopic, setInfoTopic] = useState<InfoModalTopic>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  // Sync draft form if user/settings change externally
  useEffect(() => {
    setFullName(user.fullName);
    setEmail(user.email);
    setStudioName(user.studioName);
    setPracticeFocus(user.practiceFocus);
  }, [user]);

  useEffect(() => {
    setDemoModeDraft(demoMode);
  }, [demoMode]);

  const handleSave = async () => {
    if (!fullName.trim()) {
      showToast('Architect name cannot be empty.', 'warning');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showToast('Please enter a valid professional email address.', 'warning');
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        fullName: fullName.trim(),
        email: email.trim(),
        studioName: studioName.trim() || user.studioName,
        practiceFocus,
      });
      updateSettings({
        apiBaseUrl,
        demoMode: demoModeDraft,
        unitSystem,
        autoDaylightSync,
        defaultPoseEstimator: poseEstimator,
        defaultMaxResolution: maxRes,
        notifyReconstructionComplete: notifyComplete,
        notifyClientWalkthrough: notifyClient,
        biometricPasskeyEnabled: biometricActive,
        twoFactorEnabled: twoFactorActive,
      });
      if (!mountedRef.current) return;
      setSavedFlag(true);
      showToast('Atelier profile & engine settings saved', 'success');
      const t2 = window.setTimeout(() => {
        if (mountedRef.current) setSavedFlag(false);
      }, 2000);
      timersRef.current.push(t2);
    } catch (err) {
      if (mountedRef.current) {
        showToast(
          err instanceof Error && err.message ? err.message : 'Failed to save profile settings.',
          'error'
        );
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (
      newPassword.length < 8 ||
      !/[A-Za-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      setPasswordError('New password must be at least 8 characters with a letter and a number.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      if (!mountedRef.current) return;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      showToast('Password updated and previous JWT revoked', 'success');
    } catch (err) {
      if (mountedRef.current) {
        setPasswordError(
          err instanceof Error && err.message ? err.message : 'Unable to change password.'
        );
      }
    } finally {
      if (mountedRef.current) setChangingPassword(false);
    }
  };

  const handleDiscard = () => {
    setFullName(user.fullName);
    setEmail(user.email);
    setStudioName(user.studioName);
    setPracticeFocus(user.practiceFocus);
    setUnitSystem(settings.unitSystem);
    setAutoDaylightSync(settings.autoDaylightSync);
    setApiBaseUrl(settings.apiBaseUrl);
    setDemoModeDraft(demoMode);
    setPoseEstimator(settings.defaultPoseEstimator);
    setMaxRes(settings.defaultMaxResolution);
    setNotifyComplete(settings.notifyReconstructionComplete);
    setNotifyClient(settings.notifyClientWalkthrough);
    setBiometricActive(settings.biometricPasskeyEnabled);
    setTwoFactorActive(settings.twoFactorEnabled);
    showToast('Reverted unsaved changes', 'info');
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    const res = await api.testConnection(apiBaseUrl);
    if (!mountedRef.current) return;
    setTestingConn(false);
    setConnStatus(res.latencyMs > 0 ? `${res.message} (${res.latencyMs}ms)` : res.message);
    showToast(res.message, res.ok ? 'success' : 'warning');
  };

  const handleExportManifest = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      atelier: studioName,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        dimensions: p.dimensionsLabel,
        splatCount: p.splatCountLabel || 'Pending',
      })),
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'auraspace-splat-catalog.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Ignore
    }
    showToast('Exported splat bundle manifest (.json)', 'success');
  };

  const showSection = (sec: Exclude<SettingsSection, 'all'>) =>
    activeSection === 'all' || activeSection === sec;

  return (
    <div className="min-h-screen flex flex-col bg-surface-warm text-on-surface">
      <AppHeader />

      <main className="w-full pt-20 pb-12 flex-1">
        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-8 pt-6">
          <div className="absolute -top-16 right-1/4 w-96 h-96 bg-primary-fixed-dim/20 rounded-full blur-3xl pointer-events-none -z-10" />
          <div className="absolute top-48 left-10 w-80 h-80 bg-secondary-fixed/25 rounded-full blur-3xl pointer-events-none -z-10" />

          <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-outline-variant/40">
            <div className="space-y-1 max-w-3xl">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-primary-deep font-semibold">
                  Atelier Account Dossier
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-outline-variant" />
                <span className="text-[10px] uppercase tracking-widest text-on-surface-muted font-medium">
                  Paris Studio Node
                </span>
              </div>
              <h1 className="font-headline text-4xl text-on-surface tracking-tight">
                {fullName}
              </h1>
              <p className="text-base text-on-surface-muted font-light">
                Master Architect &amp; Spatial Stylist • {studioName}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-muted font-semibold">
              <div className="flex items-center gap-1.5 bg-surface-container-high px-3.5 py-1.5 rounded-full">
                <span className="material-symbols-outlined text-[16px] text-tertiary-deep">
                  verified
                </span>
                <span className="text-tertiary-deep">License #{user.licenseId}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-surface-container px-3.5 py-1.5 rounded-full">
                <span className="material-symbols-outlined text-[16px]">schedule</span>
                <span>{user.location}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-surface-container px-3.5 py-1.5 rounded-full">
                <span className="material-symbols-outlined text-[16px]">history_edu</span>
                <span>Member {user.memberSince}</span>
              </div>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-2 mb-8">
            {[
              { id: 'all' as const, label: 'All Settings' },
              { id: 'profile' as const, label: 'Studio Profile' },
              { id: 'engine' as const, label: 'Backend & 3DGS Engine' },
              { id: 'security' as const, label: 'Security & Devices' },
              { id: 'notifications' as const, label: 'Notifications' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${
                  activeSection === tab.id
                    ? 'bg-on-surface text-surface shadow-sm'
                    : 'bg-surface-container text-on-surface-muted hover:text-on-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pb-10">
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-border-sand/60">
                <div className="flex flex-col items-center text-center">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      if (f.size > 5 * 1024 * 1024) {
                        showToast('Please choose an image smaller than 5 MB.', 'warning');
                        return;
                      }
                      try {
                        const resizedDataUrl = await downscaleAvatarToDataUrl(f);
                        if (resizedDataUrl) {
                          updateProfile({ avatarUrl: resizedDataUrl });
                          showToast('Portrait updated', 'success');
                        }
                      } catch {
                        showToast('Could not process selected portrait image.', 'error');
                      }
                    }}
                  />
                  <div className="relative group mb-4">
                    <div className="w-28 h-28 rounded-full overflow-hidden shadow-md bg-surface-container p-1">
                      <SafeImage
                        src={user.avatarUrl}
                        alt={fullName}
                        className="w-full h-full object-cover rounded-full group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      title="Change Portrait"
                      aria-label="Change Portrait"
                      className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-primary-deep text-white flex items-center justify-center shadow-md hover:scale-110 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[16px]">photo_camera</span>
                    </button>
                  </div>

                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-[10px] font-semibold tracking-wide uppercase mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-tertiary-deep" />
                    Active Atelier Member
                  </span>
                  <h2 className="font-headline text-2xl text-on-surface mt-1">{fullName}</h2>
                  <p className="text-xs text-on-surface-muted">{email}</p>
                  <p className="text-xs text-on-surface-muted mt-3 font-light leading-relaxed">
                    Leading interior architecture and spatial 3D splatting for boutique residential
                    projects across Europe.
                  </p>

                  <div className="w-full mt-5 bg-surface-container-low rounded-lg p-3.5 text-left flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-on-surface-muted block font-semibold">
                        Primary Rig
                      </span>
                      <span className="text-xs text-on-surface font-semibold">
                        {user.primaryRig}
                      </span>
                    </div>
                    <span className="material-symbols-outlined text-primary-deep text-[22px]">
                      view_in_ar
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-surface-container rounded-xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline text-xl italic text-on-surface">Studio Metrics</h3>
                  <span className="material-symbols-outlined text-outline text-[20px]">
                    analytics
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-surface-container-lowest p-3.5 rounded-lg">
                    <span className="text-[10px] uppercase tracking-wide text-on-surface-muted font-semibold">
                      Active 3D Rooms
                    </span>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-headline text-3xl text-primary-deep font-medium">
                        {projects.length}
                      </span>
                      <span className="text-[10px] text-on-surface-muted">scenes</span>
                    </div>
                  </div>
                  <div className="bg-surface-container-lowest p-3.5 rounded-lg">
                    <span className="text-[10px] uppercase tracking-wide text-on-surface-muted font-semibold">
                      Edited Scenes
                    </span>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-headline text-3xl text-on-surface font-medium">
                        {projects.filter((p) => p.hasRestyle || p.hasEditedScene).length}
                      </span>
                      <span className="text-[10px] text-on-surface-muted">rebuilt</span>
                    </div>
                  </div>
                  <div className="bg-surface-container-lowest p-3.5 rounded-lg">
                    <span className="text-[10px] uppercase tracking-wide text-on-surface-muted font-semibold">
                      Ready Scenes
                    </span>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-headline text-3xl text-on-surface font-medium">
                        {projects.filter((p) => p.status === 'ready').length}
                      </span>
                      <span className="text-[10px] text-on-surface-muted">published</span>
                    </div>
                  </div>
                  <div className="bg-surface-container-lowest p-3.5 rounded-lg">
                    <span className="text-[10px] uppercase tracking-wide text-on-surface-muted font-semibold">
                      Frame Cap
                    </span>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-lg text-primary-deep font-semibold">{maxRes}px</span>
                    </div>
                  </div>
                </div>

                <div className="pt-1 space-y-1 text-[11px] text-on-surface-muted">
                  <div className="flex items-center justify-between">
                    <span>Session Owner ID</span>
                    <code className="font-mono text-on-surface">{sessionId.slice(0, 14)}…</code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Workspace Mode</span>
                    <span className="font-semibold text-on-surface">
                      {demoMode ? 'Demo Sandbox' : 'Live FastAPI Backend'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-8 space-y-6">
              {showSection('profile') && (
                <section className="bg-surface-container-lowest rounded-xl p-6 sm:p-8 shadow-sm space-y-6 border border-border-sand/60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-headline text-2xl text-on-surface">
                        Studio &amp; Personal Profile
                      </h2>
                      <p className="text-xs text-on-surface-muted font-light">
                        Public atelier credentials and rendering configuration
                      </p>
                    </div>
                    <span className="material-symbols-outlined text-outline text-[24px]">
                      architecture
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-on-surface block" htmlFor="full-name">
                        Full Architect Name
                      </label>
                      <input
                        id="full-name"
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full bg-surface-container-low text-on-surface text-sm rounded-lg px-3.5 py-2.5 shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-on-surface" htmlFor="pro-email">
                          Professional Atelier Email
                        </label>
                        <span className="inline-flex items-center gap-1 text-[10px] text-tertiary-deep font-semibold">
                          <span className="material-symbols-outlined text-[14px]">check_circle</span>
                          Verified
                        </span>
                      </div>
                      <input
                        id="pro-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-surface-container-low text-on-surface text-sm rounded-lg px-3.5 py-2.5 shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-on-surface block" htmlFor="studio-name">
                        Design Studio / Practice
                      </label>
                      <input
                        id="studio-name"
                        type="text"
                        value={studioName}
                        onChange={(e) => setStudioName(e.target.value)}
                        className="w-full bg-surface-container-low text-on-surface text-sm rounded-lg px-3.5 py-2.5 shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-on-surface block" htmlFor="primary-focus">
                        Spatial Practice Focus
                      </label>
                      <select
                        id="primary-focus"
                        value={practiceFocus}
                        onChange={(e) => setPracticeFocus(e.target.value)}
                        className="w-full bg-surface-container-low text-on-surface text-sm rounded-lg px-3.5 py-2.5 shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option>Interior Architecture &amp; Luxury Residential</option>
                        <option>Boutique Hospitality &amp; Historic Restorations</option>
                        <option>Commercial Atelier &amp; Curated Exhibition Spaces</option>
                        <option>Private Yacht &amp; Aviation Interiors</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div className="bg-surface-container-low p-4 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-on-surface">
                          Unit Measurement System
                        </span>
                        <span className="text-[10px] text-on-surface-muted">Default</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setUnitSystem('metric')}
                          className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold transition-all ${
                            unitSystem === 'metric'
                              ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                              : 'text-on-surface-muted hover:bg-surface-container-high'
                          }`}
                        >
                          Metric (m, cm)
                        </button>
                        <button
                          type="button"
                          onClick={() => setUnitSystem('imperial')}
                          className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold transition-all ${
                            unitSystem === 'imperial'
                              ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                              : 'text-on-surface-muted hover:bg-surface-container-high'
                          }`}
                        >
                          Imperial (ft, in)
                        </button>
                      </div>
                    </div>

                    <div className="bg-surface-container-low p-4 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-on-surface">
                          Spatial Illumination Sync
                        </span>
                        <span className="material-symbols-outlined text-secondary text-[18px]">
                          wb_sunny
                        </span>
                      </div>
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-xs text-on-surface">
                          Auto-synced Natural Daylight
                        </span>
                        <input
                          type="checkbox"
                          checked={autoDaylightSync}
                          onChange={(e) => setAutoDaylightSync(e.target.checked)}
                          className="h-4 w-4 rounded accent-primary cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>
                </section>
              )}

              {showSection('engine') && (
                <section className="bg-surface-container-lowest rounded-xl p-6 sm:p-8 shadow-sm space-y-5 border border-border-sand/60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-headline text-2xl text-on-surface">
                        Backend &amp; 3DGS Pipeline Endpoint
                      </h2>
                      <p className="text-xs text-on-surface-muted font-light">
                        Connect to your FastAPI + Cloudflare Kaggle worker or run in local sandbox
                        mode
                      </p>
                    </div>
                    <span className="material-symbols-outlined text-outline text-[24px]">dns</span>
                  </div>

                  <div className="bg-surface-container-low p-4 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-on-surface">
                        Workspace Mode: Live FastAPI Backend
                      </span>
                      <span className="text-[10px] font-mono text-on-surface-muted">
                        X-Session-Id: {sessionId.slice(0, 12)}…
                      </span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant">
                      All authentication, projects, tasks, and 3D artifacts strictly use the live
                      FastAPI backend (defaulting to <code className="font-mono">/api</code> proxy
                      when no custom URL is entered below).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-on-surface block" htmlFor="api-url">
                      FastAPI Backend Base URL (leave blank to use default /api proxy)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id="api-url"
                        type="url"
                        value={apiBaseUrl}
                        onChange={(e) => {
                          setApiBaseUrl(e.target.value);
                        }}
                        placeholder="/api (default proxy) or http://localhost:8000"
                        className="flex-1 bg-surface-container-low text-on-surface text-xs font-mono rounded-lg px-3.5 py-2.5 shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        type="button"
                        disabled={testingConn}
                        onClick={() => void handleTestConnection()}
                        className="px-4 py-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-colors shrink-0"
                      >
                        {testingConn ? 'Testing...' : 'Test Connection'}
                      </button>
                    </div>
                    {connStatus && (
                      <p className="text-xs text-on-surface-muted pt-1">{connStatus}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-on-surface block" htmlFor="pose-est">
                        Default Pose Estimator (Week 1)
                      </label>
                      <select
                        id="pose-est"
                        value={poseEstimator}
                        onChange={(e) => setPoseEstimator(e.target.value as 'GLOMAP' | 'VGGT')}
                        className="w-full bg-surface-container-low text-on-surface text-xs font-semibold rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="GLOMAP">GLOMAP (Global SfM • COLMAP sparse/0)</option>
                        <option value="VGGT">VGGT (Feed-Forward fp16 chunks)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-on-surface block" htmlFor="max-res">
                        Default Frame Long-Side Cap
                      </label>
                      <select
                        id="max-res"
                        value={maxRes}
                        onChange={(e) => setMaxRes(Number(e.target.value) as 640 | 768 | 960)}
                        className="w-full bg-surface-container-low text-on-surface text-xs font-semibold rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option value={640}>640 px (Fast T4 Budget)</option>
                        <option value={768}>768 px (Balanced)</option>
                        <option value={960}>960 px (Maximum Detail Cap)</option>
                      </select>
                    </div>
                  </div>
                </section>
              )}

              {showSection('security') && (
                <section className="bg-surface-container-lowest rounded-xl p-6 sm:p-8 shadow-sm space-y-5 border border-border-sand/60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-headline text-2xl text-on-surface">
                        Spatial Security &amp; Access
                      </h2>
                      <p className="text-xs text-on-surface-muted font-light">
                        Biometric keys and verified client rendering privileges
                      </p>
                    </div>
                    <span className="material-symbols-outlined text-outline text-[24px]">
                      shield
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-surface-container-low p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary-deep shadow-sm">
                          <span className="material-symbols-outlined text-[20px]">fingerprint</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm text-on-surface font-semibold">
                              Biometric Passkey
                            </h3>
                            <span className="px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-[10px] font-semibold">
                              {biometricActive ? 'Active' : 'Disabled'}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-muted font-light">
                            Apple Touch ID &amp; Windows Hello hardware binding
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setBiometricActive((v) => !v);
                          showToast(
                            biometricActive
                              ? 'Biometric passkey disabled'
                              : 'Biometric passkey enabled',
                            'info'
                          );
                        }}
                        className="px-4 py-1.5 rounded-full bg-surface-container-highest hover:bg-surface-dim text-xs font-semibold text-on-surface transition-colors self-start sm:self-auto"
                      >
                        {biometricActive ? 'Disable Passkey' : 'Enable Passkey'}
                      </button>
                    </div>

                    <div className="bg-surface-container-low p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-surface-container-lowest flex items-center justify-center text-secondary shadow-sm">
                          <span className="material-symbols-outlined text-[20px]">key</span>
                        </div>
                        <div>
                          <h3 className="text-sm text-on-surface font-semibold">
                            Master Atelier Key
                          </h3>
                          <p className="text-xs text-on-surface-muted font-light">
                            Last rotated today at 09:14 CET (Paris Studio)
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setRotatedKeyToken(
                            `as_live_paris_${Math.random().toString(36).slice(2, 12)}`
                          );
                          setKeyModalOpen(true);
                        }}
                        className="px-4 py-1.5 rounded-full bg-surface-container-highest hover:bg-surface-dim text-xs font-semibold text-on-surface transition-colors self-start sm:self-auto"
                      >
                        Rotate Key
                      </button>
                    </div>

                    <div className="bg-surface-container-low p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-surface-container-lowest flex items-center justify-center text-tertiary-deep shadow-sm">
                          <span className="material-symbols-outlined text-[20px]">security</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm text-on-surface font-semibold">
                              Two-Factor Spatial Authentication
                            </h3>
                            <span className="px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-[10px] font-semibold">
                              {twoFactorActive ? 'Enforced' : 'Optional'}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-muted font-light">
                            App Authenticator (TOTP) bound to studio iPhone
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTwoFactorActive((v) => !v);
                          showToast('Updated 2FA spatial authentication status', 'success');
                        }}
                        className="px-4 py-1.5 rounded-full bg-surface-container-highest hover:bg-surface-dim text-xs font-semibold text-on-surface transition-colors self-start sm:self-auto"
                      >
                        Toggle 2FA
                      </button>
                    </div>

                    {/* Account Role & RBAC Permissions */}
                    <div className="bg-surface-container-low p-4 rounded-lg space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-sm text-on-surface font-semibold">
                          Account Role &amp; RBAC Permissions
                        </h3>
                        <span className="px-2.5 py-0.5 rounded-full bg-primary-container text-primary text-[10px] font-bold uppercase tracking-wider">
                          {user.accountRole || 'member'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(user.permissions && user.permissions.length > 0
                          ? user.permissions
                          : ['project:read']
                        ).map((perm) => (
                          <span
                            key={perm}
                            className="px-2 py-0.5 rounded-md bg-surface-container-lowest border border-border-sand text-[10px] font-mono text-on-surface-variant"
                          >
                            {perm}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Change Password (Live JWT Rotation) */}
                    <form
                      onSubmit={(e) => void handleChangePassword(e)}
                      className="bg-surface-container-low p-4 rounded-lg space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm text-on-surface font-semibold">Change Password</h3>
                        <span className="text-[10px] text-on-surface-muted uppercase tracking-wider">
                          Rotates JWT
                        </span>
                      </div>
                      {passwordError && (
                        <div
                          role="alert"
                          className="rounded-lg bg-error-container text-on-error-container px-3 py-2 text-xs font-medium"
                        >
                          {passwordError}
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <input
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="Current password"
                          aria-label="Current password"
                          className="bg-surface-container-lowest text-on-surface text-xs rounded-lg px-3 py-2 border border-border-sand/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="New password (8+ chars)"
                          aria-label="New password"
                          className="bg-surface-container-lowest text-on-surface text-xs rounded-lg px-3 py-2 border border-border-sand/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <input
                          type="password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          placeholder="Confirm new password"
                          aria-label="Confirm new password"
                          className="bg-surface-container-lowest text-on-surface text-xs rounded-lg px-3 py-2 border border-border-sand/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={changingPassword}
                          className="px-4 py-1.5 rounded-full bg-on-surface text-surface text-xs font-semibold hover:opacity-90 disabled:opacity-60"
                        >
                          {changingPassword ? 'Updating...' : 'Update Password'}
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              )}

              {showSection('notifications') && (
                <section className="bg-surface-container-lowest rounded-xl p-6 sm:p-8 shadow-sm space-y-5 border border-border-sand/60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-headline text-2xl text-on-surface">
                        Notifications &amp; Client Delivery
                      </h2>
                      <p className="text-xs text-on-surface-muted font-light">
                        Spatial processing alerts and collaborative review updates
                      </p>
                    </div>
                    <span className="material-symbols-outlined text-outline text-[24px]">
                      notifications
                    </span>
                  </div>

                  <div className="space-y-4">
                    <label className="flex items-start justify-between gap-4 cursor-pointer group">
                      <div>
                        <span className="text-sm text-on-surface font-medium group-hover:text-primary-deep transition-colors block">
                          3D Neural Splat Reconstruction Completion
                        </span>
                        <span className="text-xs text-on-surface-muted font-light block mt-0.5">
                          Receive instant dispatch alerts when cloud GPU finishes point cloud
                          synthesis.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifyComplete}
                        onChange={(e) => setNotifyComplete(e.target.checked)}
                        className="mt-1 h-5 w-5 rounded accent-primary cursor-pointer"
                      />
                    </label>
                    <div className="h-px bg-surface-variant/40" />
                    <label className="flex items-start justify-between gap-4 cursor-pointer group">
                      <div>
                        <span className="text-sm text-on-surface font-medium group-hover:text-primary-deep transition-colors block">
                          Client Walkthrough &amp; Redesign Interaction Alerts
                        </span>
                        <span className="text-xs text-on-surface-muted font-light block mt-0.5">
                          Notify me whenever a homeowner views their 3D walkthrough or swaps
                          furniture materials.
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifyClient}
                        onChange={(e) => setNotifyClient(e.target.checked)}
                        className="mt-1 h-5 w-5 rounded accent-primary cursor-pointer"
                      />
                    </label>
                  </div>
                </section>
              )}

              <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 border border-border-sand/60">
                <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-muted">
                  <button
                    type="button"
                    onClick={handleExportManifest}
                    className="hover:text-primary-deep transition-colors flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    <span>Export Raw Splats (.json manifest)</span>
                  </button>
                  <span className="text-outline-variant">•</span>
                  <button
                    type="button"
                    onClick={() => setInfoTopic('privacy')}
                    className="hover:text-primary-deep transition-colors"
                  >
                    Atelier Privacy Protocol
                  </button>
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleDiscard}
                    className="flex-1 sm:flex-initial px-5 py-2.5 rounded-md bg-surface-container-highest hover:bg-surface-dim text-xs text-on-surface font-medium transition-all"
                  >
                    Discard Changes
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave()}
                    className={`flex-1 sm:flex-initial px-6 py-2.5 rounded-md text-on-primary text-xs font-semibold transition-all shadow-md active:scale-95 ${
                      savedFlag
                        ? 'bg-tertiary-deep'
                        : 'bg-primary-container-deep hover:bg-primary-deep'
                    }`}
                  >
                    {saving
                      ? 'Updating Atelier Ledger...'
                      : savedFlag
                        ? 'Dossier Saved ✓'
                        : 'Save Profile Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <AppFooter />

      <AtelierModal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        title="Rotate Master Atelier Key"
        subtitle="Generate a fresh API & workspace encryption token"
        icon="key"
      >
        <div className="space-y-4 text-xs">
          <p className="text-on-surface-muted">
            Rotating your atelier key refreshes your local session credentials while keeping all 3D
            scenes intact.
          </p>
          <div className="p-3 rounded-xl bg-surface-container-low font-mono text-on-surface">
            {rotatedKeyToken}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setKeyModalOpen(false);
                showToast('Master Atelier Key rotated cleanly', 'success');
              }}
              className="px-5 py-2 rounded-full bg-primary text-white font-semibold"
            >
              Confirm Rotation
            </button>
          </div>
        </div>
      </AtelierModal>

      <InfoTopicModal topic={infoTopic} onClose={() => setInfoTopic(null)} />
    </div>
  );
};
