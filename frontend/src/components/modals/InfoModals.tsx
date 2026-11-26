import React, { useEffect, useId, useState } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string;
  children: React.ReactNode;
}

export const AtelierModal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  icon = 'auto_stories',
  children,
}) => {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface-container-lowest border border-border-sand shadow-hover overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 bg-surface-container-low border-b border-border-sand flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-container text-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">{icon}</span>
            </div>
            <div>
              <h3
                id={titleId}
                className="font-headline text-xl font-medium text-on-surface leading-tight"
              >
                {title}
              </h3>
              {subtitle && <p className="text-xs text-on-surface-variant">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors"
            aria-label="Close modal"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="p-6 max-h-[75vh] overflow-y-auto atelier-scroll">{children}</div>
      </div>
    </div>
  );
};

export type InfoModalTopic = 'inspiration' | 'privacy' | 'photogrammetry' | 'concierge' | null;

export const InfoTopicModal: React.FC<{
  topic: InfoModalTopic;
  onClose: () => void;
}> = ({ topic, onClose }) => {
  const [conciergeSent, setConciergeSent] = useState(false);
  const [conciergeNote, setConciergeNote] = useState('');

  useEffect(() => {
    setConciergeSent(false);
    setConciergeNote('');
  }, [topic]);

  if (!topic) return null;

  if (topic === 'inspiration') {
    return (
      <AtelierModal
        open
        onClose={onClose}
        title="Inspiration & Capture Guide"
        subtitle="Architectural walkthrough best practices for Gaussian Splats"
        icon="auto_stories"
      >
        <div className="space-y-4 text-xs text-on-surface-variant leading-relaxed">
          <div className="p-4 rounded-xl bg-surface-container-low border border-border-sand">
            <h4 className="font-semibold text-on-surface text-sm mb-1.5 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[18px]">videocam</span>
              Ideal Room Walkthrough (2–5 Minutes)
            </h4>
            <p>
              Walk slowly around the perimeter at chest height in a single continuous loop. Avoid
              rapid panning so frame extraction (1–4 fps) preserves crisp parallax overlap.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-surface-container-low border border-border-sand">
              <p className="font-semibold text-on-surface mb-1">Resolution Cap: 640–960 px</p>
              <p>
                Frames are automatically downscaled and Laplacian blur-filtered before GLOMAP/VGGT
                pose estimation so training runs cleanly within T4 GPU memory.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-surface-container-low border border-border-sand">
              <p className="font-semibold text-on-surface mb-1">Daylight & Material Prompting</p>
              <p>
                Open sheer curtains for diffuse natural light. Try prompts like “Vintage Cognac
                Leather Club Chair” or “Dark Green Leather Sofa” in Edit Object mode.
              </p>
            </div>
          </div>
        </div>
      </AtelierModal>
    );
  }

  if (topic === 'privacy') {
    return (
      <AtelierModal
        open
        onClose={onClose}
        title="Privacy & Spatial Guard"
        subtitle="256-Bit encryption & private atelier asset protection"
        icon="verified_user"
      >
        <div className="space-y-3 text-xs text-on-surface-variant leading-relaxed">
          <p>
            All uploaded room walkthrough videos, extracted COLMAP camera poses, and 3D Gaussian
            Splat bundles (`.ply` / `.splat`) remain private to your atelier workspace.
          </p>
          <div className="p-3.5 rounded-xl bg-tertiary-container/40 border border-tertiary/20 text-tertiary">
            <p className="font-semibold mb-1">Per-Project Data Isolation</p>
            <p>
              Videos are never shared globally or used for public model training. You can export raw
              splats or delete any space at any time from My Spaces or Atelier Settings.
            </p>
          </div>
        </div>
      </AtelierModal>
    );
  }

  if (topic === 'photogrammetry') {
    return (
      <AtelierModal
        open
        onClose={onClose}
        title="Spatial Photogrammetry Pipeline"
        subtitle="Week 1 & Week 2 Reconstruction Architecture"
        icon="view_in_ar"
      >
        <div className="space-y-3 text-xs text-on-surface-variant leading-relaxed">
          <ol className="space-y-2 list-decimal pl-4">
            <li>
              <strong className="text-on-surface">Frame Extraction (ffmpeg):</strong> 1–4 fps
              sampling, 640–960 px long side resize, Laplacian variance blur rejection.
            </li>
            <li>
              <strong className="text-on-surface">Pose Estimation (GLOMAP / VGGT):</strong>{' '}
              Sequential matching & global SfM exported as COLMAP `images/` + `sparse/0/`.
            </li>
            <li>
              <strong className="text-on-surface">3D Gaussian Splatting:</strong> 7k–30k
              iterations starting from sparse points, exported to compact `.splat`.
            </li>
            <li>
              <strong className="text-on-surface">Object Redesign (SAM + Diffusion):</strong>{' '}
              Reference frame click + positive/negative mask refinement, tracked across frames,
              edited with reference conditioning, and rebuilt without re-running pose estimation.
            </li>
          </ol>
        </div>
      </AtelierModal>
    );
  }

  return (
    <AtelierModal
      open
      onClose={onClose}
      title="Atelier Concierge"
      subtitle="Direct spatial studio engineering & capture assistance"
      icon="support_agent"
    >
      {conciergeSent ? (
        <div className="p-4 rounded-xl bg-tertiary-container/50 text-tertiary text-xs space-y-2">
          <p className="font-semibold text-sm flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            Request logged with Atelier Support
          </p>
          <p>
            Our spatial specialists will respond to your atelier email shortly. Your local studio
            sessions remain active.
          </p>
          <button
            type="button"
            onClick={() => {
              setConciergeSent(false);
              setConciergeNote('');
              onClose();
            }}
            className="mt-2 px-4 py-2 rounded-full bg-primary text-white font-semibold text-xs"
          >
            Done
          </button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setConciergeSent(true);
          }}
        >
          <p className="text-xs text-on-surface-variant">
            Need help connecting your FastAPI / Kaggle Cloudflare tunnel or troubleshooting a room
            capture? Send a note below.
          </p>
          <textarea
            required
            rows={3}
            value={conciergeNote}
            onChange={(e) => setConciergeNote(e.target.value)}
            placeholder="Describe your capture or backend endpoint question..."
            className="w-full rounded-xl border border-border-sand bg-surface-container-low p-3 text-xs text-on-surface focus:outline-none focus:border-primary"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-surface-container text-xs font-medium text-on-surface-variant"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors"
            >
              Send to Concierge
            </button>
          </div>
        </form>
      )}
    </AtelierModal>
  );
};
