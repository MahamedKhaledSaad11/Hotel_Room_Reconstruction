import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useProjects } from '../../context/ProjectsContext';
import { useToast } from '../../context/ToastContext';
import { SafeImage } from '../common/SafeImage';
import { InfoModalTopic, InfoTopicModal } from '../modals/InfoModals';

export const AppHeader: React.FC = () => {
  const { user, isAuthenticated, demoMode, signOut } = useAuth();
  const { projects, activeTaskId } = useProjects();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [infoTopic, setInfoTopic] = useState<InfoModalTopic>(null);
  const menuWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuWrapperRef.current && !menuWrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const firstReadyProject = projects.find((p) => p.status === 'ready') || projects[0];
  const walkthroughPath = firstReadyProject ? `/studio/${firstReadyProject.id}` : '/studio';
  const progressPath = activeTaskId ? `/progress/${activeTaskId}` : '/progress';

  const navItems = [
    { label: 'Spaces', to: '/spaces', matchPrefix: ['/spaces', '/'] },
    { label: 'Scan New Room', to: '/scan', matchPrefix: ['/scan'] },
    { label: 'Room Processing', to: progressPath, matchPrefix: ['/progress'] },
    { label: '3D Room Walkthrough', to: walkthroughPath, matchPrefix: ['/studio'] },
    { label: 'Settings', to: '/settings', matchPrefix: ['/settings'] },
  ];

  const isPathMatch = (matchPrefix: string[]) =>
    matchPrefix.some(
      (prefix) =>
        prefix === location.pathname ||
        (prefix !== '/' && location.pathname.startsWith(prefix))
    );

  return (
    <>
      <header className="fixed top-0 w-full z-50 bg-[#FFFDF9]/90 backdrop-blur-md border-b border-border-sand">
        <div className="max-w-7xl mx-auto h-20 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link to="/spaces" className="flex flex-col group shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary group-hover:scale-125 transition-transform duration-300" />
                <span className="font-headline italic text-2xl font-medium tracking-tight text-on-surface">
                  AuraSpace
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-widest font-semibold text-on-surface-variant pl-4 -mt-0.5">
                Interior 3D Studio
              </span>
            </Link>

            <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
              {navItems.map((item) => (
                <NavLink
                  key={item.label}
                  to={item.to}
                  className={({ isActive }) => {
                    const active = isActive || isPathMatch(item.matchPrefix);
                    return active
                      ? 'px-4 py-2 rounded-full text-xs font-semibold bg-surface-container text-on-surface transition-all'
                      : 'px-4 py-2 rounded-full text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-all';
                  }}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setInfoTopic('inspiration')}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">auto_stories</span>
              <span>Inspiration Guide</span>
            </button>

            <div className="h-5 w-px bg-border-sand hidden sm:block" />

            <div className="relative" ref={menuWrapperRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-3 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/40 p-0.5 pr-1 transition-all"
                aria-expanded={menuOpen}
                aria-label="Open profile menu"
              >
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-semibold text-on-surface flex items-center justify-end gap-1.5">
                    <span>
                      {isAuthenticated
                        ? user.fullName || user.email || 'Atelier Member'
                        : 'Sign In Required'}
                    </span>
                    {demoMode && (
                      <span className="px-1.5 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed text-[9px] uppercase tracking-wider">
                        Demo
                      </span>
                    )}
                    {isAuthenticated && user.accountRole === 'admin' && (
                      <span className="px-1.5 py-0.5 rounded bg-primary-container text-primary text-[9px] uppercase tracking-wider">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-on-surface-variant font-light">
                    {isAuthenticated
                      ? user.title || user.role
                      : demoMode
                        ? 'Demo Sandbox'
                        : 'Live Mode'}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full border border-border-sand overflow-hidden p-0.5 shadow-sm bg-surface-container-low">
                  <SafeImage
                    src={isAuthenticated ? user.avatarUrl : ''}
                    alt={user.fullName || 'Atelier User'}
                    fallbackLabel={(user.fullName || user.email || 'AS').slice(0, 2).toUpperCase()}
                    className="w-full h-full object-cover rounded-full"
                  />
                </div>
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-surface-container-lowest border border-border-sand shadow-hover p-2 z-50 text-xs">
                  <div className="px-3 py-2 border-b border-border-sand/70 mb-1">
                    <p className="font-semibold text-on-surface truncate">
                      {isAuthenticated ? user.fullName || 'Atelier Member' : 'Guest'}
                    </p>
                    <p className="text-[11px] text-on-surface-variant truncate">
                      {isAuthenticated ? user.email : 'Not signed in'}
                    </p>
                  </div>
                  <Link
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-surface-container-low text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      tune
                    </span>
                    <span>Profile &amp; Atelier Settings</span>
                  </Link>
                  <Link
                    to="/scan"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-surface-container-low text-on-surface transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      video_camera_front
                    </span>
                    <span>Scan New Room</span>
                  </Link>
                  <div className="my-1 h-px bg-border-sand/60" />
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => {
                        signOut();
                        setMenuOpen(false);
                        showToast('Signed out of Atelier session', 'info');
                        navigate('/login');
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-error-container/40 text-error transition-colors text-left"
                    >
                      <span className="material-symbols-outlined text-[16px]">logout</span>
                      <span>Sign Out</span>
                    </button>
                  ) : (
                    <Link
                      to="/login"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-surface-container-low text-primary font-semibold transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">login</span>
                      <span>Sign In</span>
                    </Link>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              className="lg:hidden w-9 h-9 rounded-full bg-surface-container-low border border-border-sand flex items-center justify-center text-on-surface"
              aria-label="Toggle navigation menu"
            >
              <span className="material-symbols-outlined text-[20px]">
                {mobileNavOpen ? 'close' : 'menu'}
              </span>
            </button>
          </div>
        </div>

        {mobileNavOpen && (
          <div className="lg:hidden bg-surface border-t border-border-sand px-4 py-3 flex flex-col gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) => {
                  const active = isActive || isPathMatch(item.matchPrefix);
                  return active
                    ? 'px-4 py-2.5 rounded-xl text-xs font-semibold bg-surface-container text-primary'
                    : 'px-4 py-2.5 rounded-xl text-xs font-medium text-on-surface-variant hover:bg-surface-container-low';
                }}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </header>

      <InfoTopicModal topic={infoTopic} onClose={() => setInfoTopic(null)} />
    </>
  );
};
