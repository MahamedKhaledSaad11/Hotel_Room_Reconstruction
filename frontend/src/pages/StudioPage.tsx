import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { AtelierModal } from '../components/modals/InfoModals';
import { SceneViewer } from '../components/studio/SceneViewer';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import type { Project, ProjectShareDTO, SceneData } from '../types';

export const StudioPage: React.FC = () => {
  const { projectId } = useParams<{ projectId?: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [scene, setScene] = useState<SceneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [shares, setShares] = useState<ProjectShareDTO[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareLabel, setShareLabel] = useState('Room walkthrough');
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const canShare = Boolean(user.permissions?.includes('project:share'));
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setScene(null);
    setProject(null);
    const load = async () => {
      try {
        const target = projectId
          ? await api.getProject(projectId)
          : (await api.getProjects()).find((item) => item.status === 'ready');
        if (!active) return;
        if (!target)
          throw new Error(
            'No reconstructed room is available yet. Upload a video to create your first scene.'
          );
        setProject(target);
        if (target.status !== 'ready') return;
        const data = await api.getScene(target);
        if (active) setScene(data);
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Unable to open this room.'
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [projectId, attempt]);
  useEffect(() => {
    if (!shareOpen || !project || !canShare) return;
    let active = true;
    setShareLoading(true);
    setShareError('');
    void api
      .listProjectShares(project.id)
      .then((rows) => {
        if (active) setShares(rows);
      })
      .catch((failure) => {
        if (active)
          setShareError(
            failure instanceof Error
              ? failure.message
              : 'Unable to load share links.'
          );
      })
      .finally(() => {
        if (active) setShareLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shareOpen, project?.id, canShare]);
  const createShare = async () => {
    if (!project || shareBusy) return;
    setShareBusy(true);
    setShareError('');
    try {
      const created = await api.createProjectShare(
        project.id,
        shareLabel.trim() || 'Room walkthrough',
        72
      );
      if (!created.sharePath && !created.shareToken)
        throw new Error('The server did not return a share link.');
      const path = created.sharePath || `/shared/${created.shareToken}`;
      const url = new URL(path, window.location.origin).toString();
      setShareUrl(url);
      setShares((previous) => [created, ...previous]);
      try {
        await navigator.clipboard.writeText(url);
        showToast('Share link created and copied.', 'success');
      } catch {
        showToast('Share link created. Copy it from the field.', 'success');
      }
    } catch (failure) {
      setShareError(
        failure instanceof Error
          ? failure.message
          : 'Unable to create share link.'
      );
    } finally {
      setShareBusy(false);
    }
  };
  const revokeShare = async (shareId: string) => {
    if (!project || shareBusy) return;
    setShareBusy(true);
    setShareError('');
    try {
      await api.revokeProjectShare(project.id, shareId);
      setShares((previous) =>
        previous.map((item) =>
          item.shareId === shareId ? { ...item, isActive: false } : item
        )
      );
      setShareUrl('');
      showToast('Share link revoked.', 'info');
    } catch (failure) {
      setShareError(
        failure instanceof Error
          ? failure.message
          : 'Unable to revoke share link.'
      );
    } finally {
      setShareBusy(false);
    }
  };
  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col">
      <AppHeader />
      <main className="pt-24 pb-6 px-4 sm:px-8 w-full max-w-[1600px] mx-auto flex-1 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div>
            <Link
              to="/spaces"
              className="text-xs text-on-surface-variant hover:text-primary"
            >
              ← My Spaces
            </Link>
            <h1 className="font-headline text-3xl sm:text-4xl mt-2">
              {project?.name || 'Room viewer'}
            </h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Explore your reconstructed room from different viewpoints.
            </p>
          </div>
          {scene && canShare && (
            <button
              type="button"
              onClick={() => {
                setShareUrl('');
                setShareOpen(true);
              }}
              className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-primary-hover"
            >
              <span className="material-symbols-outlined text-[18px] align-middle mr-2">
                share
              </span>
              Share walkthrough
            </button>
          )}
        </div>
        {loading ? (
          <div
            role="status"
            className="flex-1 min-h-[420px] flex items-center justify-center rounded-3xl border border-border-sand bg-white text-on-surface-variant"
          >
            Opening reconstructed room…
          </div>
        ) : scene ? (
          <div className="h-[calc(100dvh-240px)] min-h-[440px]">
            <SceneViewer scene={scene} />
          </div>
        ) : (
          <div className="min-h-[420px] rounded-3xl border border-border-sand bg-white p-8 flex flex-col items-center justify-center text-center">
            <span className="material-symbols-outlined text-4xl text-primary">
              view_in_ar
            </span>
            <h2 className="font-headline text-2xl mt-4">
              {project?.status === 'processing'
                ? 'Reconstruction in progress'
                : project?.status === 'failed'
                  ? 'Reconstruction failed'
                  : 'Scene not ready'}
            </h2>
            <p
              role={error ? 'alert' : undefined}
              className="mt-3 text-sm text-on-surface-variant max-w-lg"
            >
              {error ||
                (project?.status === 'processing'
                  ? 'Your scene will be available when reconstruction finishes.'
                  : 'Upload a room video and complete reconstruction to open the viewer.')}
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              {project?.taskId && (
                <Link
                  className="rounded-full bg-primary px-5 py-2 text-white text-sm"
                  to={`/progress/${project.taskId}`}
                >
                  View reconstruction
                </Link>
              )}
              <Link
                to={project ? `/scan?projectId=${project.id}` : '/scan'}
                className="rounded-full border border-border-sand px-5 py-2 text-sm"
              >
                Upload video
              </Link>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="rounded-full border border-border-sand px-5 py-2 text-sm"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </main>
      <AtelierModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share walkthrough"
        subtitle="Read-only links expire after 72 hours and can be revoked."
        icon="share"
      >
        <div className="space-y-4">
          <label className="block text-xs font-semibold">
            Link label
            <input
              value={shareLabel}
              onChange={(event) => setShareLabel(event.target.value)}
              maxLength={120}
              className="block mt-2 w-full rounded-xl border border-border-sand p-3 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={shareBusy}
            onClick={() => void createShare()}
            className="rounded-full bg-primary px-5 py-2.5 text-white text-sm disabled:opacity-50"
          >
            {shareBusy ? 'Please wait…' : 'Create and copy link'}
          </button>
          {shareUrl && (
            <label className="block text-xs">
              New share link
              <input
                readOnly
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 w-full rounded-xl border border-border-sand p-3 text-xs"
              />
            </label>
          )}
          {shareError && (
            <p role="alert" className="text-error text-sm">
              {shareError}
            </p>
          )}
          {shareLoading ? (
            <p role="status" className="text-sm text-on-surface-variant">
              Loading share links…
            </p>
          ) : shares.length === 0 ? (
            <p className="text-xs text-on-surface-variant">
              No share links yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {shares.map((item) => (
                <li
                  key={item.shareId}
                  className="flex gap-3 justify-between items-center rounded-xl bg-surface-container-low p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {item.label}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {!item.isActive
                        ? 'Revoked'
                        : new Date(item.expiresAt).getTime() < Date.now()
                          ? 'Expired'
                          : `Expires ${new Date(item.expiresAt).toLocaleString()}`}
                    </p>
                  </div>
                  {item.isActive &&
                    new Date(item.expiresAt).getTime() > Date.now() && (
                      <button
                        type="button"
                        disabled={shareBusy}
                        onClick={() => void revokeShare(item.shareId)}
                        className="text-xs text-error font-semibold disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </AtelierModal>
    </div>
  );
};
