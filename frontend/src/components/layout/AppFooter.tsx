import React, { useState } from 'react';
import { InfoModalTopic, InfoTopicModal } from '../modals/InfoModals';

export const AppFooter: React.FC = () => {
  const [topic, setTopic] = useState<InfoModalTopic>(null);

  return (
    <>
      <footer className="w-full bg-[#FAF6F0] border-t border-border-sand py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-on-surface-variant font-light">
          <div className="flex items-center gap-2">
            <span className="font-headline italic text-base text-on-surface font-medium">
              AuraSpace
            </span>
            <span className="text-border-sand">•</span>
            <span>Crafted for interior architects &amp; homeowners</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6">
            <button
              type="button"
              onClick={() => setTopic('privacy')}
              className="hover:text-on-surface transition-colors"
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => setTopic('inspiration')}
              className="hover:text-on-surface transition-colors"
            >
              Capture Tips
            </button>
            <button
              type="button"
              onClick={() => setTopic('photogrammetry')}
              className="hover:text-on-surface transition-colors"
            >
              Spatial Photogrammetry
            </button>
            <span>© 2026 AuraSpace Studio</span>
          </div>
        </div>
      </footer>
      <InfoTopicModal topic={topic} onClose={() => setTopic(null)} />
    </>
  );
};
