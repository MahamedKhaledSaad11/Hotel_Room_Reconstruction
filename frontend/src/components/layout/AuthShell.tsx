import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { InfoModalTopic, InfoTopicModal } from '../modals/InfoModals';

export const AuthShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [topic, setTopic] = useState<InfoModalTopic>(null);

  return (
    <div className="bg-surface-warm font-body text-on-surface min-h-screen flex flex-col justify-between selection:bg-secondary-fixed selection:text-on-secondary-fixed">
      <header className="fixed top-0 w-full z-50 bg-surface-warm/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(36,30,27,0.04)]">
        <div className="h-20 max-w-7xl mx-auto px-6 lg:px-12 flex items-center justify-between">
          <Link to="/spaces" className="flex items-center gap-2 group text-left">
            <div className="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-primary-deep group-hover:bg-primary-deep group-hover:text-on-primary transition-all duration-300 shadow-[0_2px_8px_rgba(138,67,37,0.08)]">
              <span className="material-symbols-outlined text-[20px]">view_in_ar</span>
            </div>
            <div className="flex flex-col">
              <span className="font-headline text-xl font-medium tracking-tight text-on-surface">
                AuraSpace
              </span>
              <span className="text-[10px] font-semibold text-outline tracking-wider uppercase">
                3D Interior Studio
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              to="/spaces"
              className="text-xs font-semibold text-on-surface-muted hover:text-on-surface transition-colors"
            >
              Explore Spaces
            </Link>
            <button
              type="button"
              onClick={() => setTopic('concierge')}
              className="text-xs font-semibold text-on-surface-muted hover:text-on-surface transition-colors"
            >
              Need Help?
            </button>
            <Link
              to="/settings"
              title="Atelier Settings"
              className="w-8 h-8 rounded-full bg-primary-deep flex items-center justify-center shadow-sm hover:bg-primary-container-deep transition-colors"
            >
              <span className="material-symbols-outlined text-white text-[18px]">person</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="w-full flex-1 pt-20 bg-surface-warm flex flex-col justify-center">
        {children}
      </main>

      <footer className="w-full bg-surface-container-low shadow-[0_-1px_6px_rgba(36,30,27,0.03)] py-6">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="font-headline text-sm text-on-surface-muted">AuraSpace</span>
            <span className="text-border-sand text-sm">•</span>
            <span className="text-xs text-outline">Crafted for Designers &amp; Homeowners</span>
          </div>
          <nav className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setTopic('privacy')}
              className="text-[11px] font-semibold text-on-surface-muted hover:text-on-surface transition-colors"
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => setTopic('photogrammetry')}
              className="text-[11px] font-semibold text-on-surface-muted hover:text-on-surface transition-colors"
            >
              Terms &amp; Pipeline
            </button>
            <button
              type="button"
              onClick={() => setTopic('concierge')}
              className="text-[11px] font-semibold text-on-surface-muted hover:text-on-surface transition-colors"
            >
              Support
            </button>
          </nav>
        </div>
      </footer>

      <InfoTopicModal topic={topic} onClose={() => setTopic(null)} />
    </div>
  );
};
