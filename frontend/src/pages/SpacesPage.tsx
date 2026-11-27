import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { AppFooter } from '../components/layout/AppFooter';
import { SafeImage } from '../components/common/SafeImage';
import { AtelierModal } from '../components/modals/InfoModals';
import { useAuth } from '../context/AuthContext';
import { useProjects } from '../context/ProjectsContext';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import { Project, ProjectShareDTO } from '../types';

type FilterTab = 'all' | 'living' | 'kitchen' | 'bedroom' | 'draft';
type SortOption = 'recent' | 'name';
type ViewMode = 'grid' | 'list';

export const SpacesPage: React.FC = () => {
  const { demoMode } = useAuth();
  const {
    projects,
    projectsLoading,
    projectsError,
    refreshProjects,
    startProjectReconstruction,
    deleteProject,
  } = useProjects();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const [shareProject, setShareProject] = useState<Project | null>(null);
  const [shares, setShares] = useState<ProjectShareDTO[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [creatingShare, setCreatingShare] = useState(false);
  const [shareLabel, setShareLabel] = useState('Client Walkthrough Link');
  const [latestShareUrl, setLatestShareUrl] = useState<string | null>(null);
  const [framesProject, setFramesProject] = useState<Project | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  useEffect(() => {
    if (!shareProject) {
      setShares([]);
      setLatestShareUrl(null);
      return;
    }
    if (demoMode) {
      setShares([]);
      setLatestShareUrl(`${window.location.origin}/studio/${shareProject.id}`);
      return;
    }
    let active = true;
    setSharesLoading(true);
    void api
      .listProjectShares(shareProject.id)
      .then((rows) => {
        if (active) setShares(rows);
      })
      .catch(() => {
        if (active) setShares([]);
      })
      .finally(() => {
        if (active) setSharesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shareProject, demoMode]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = projects.filter((p) => {
      const matchesCat =
        activeFilter === 'all'
          ? true
          : activeFilter === 'draft'
            ? p.status === 'draft'
            : p.category === activeFilter;
      const matchesQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.categoryLabel.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [projects, activeFilter, searchQuery, sortBy]);

  const handleGenerateDraft = async (project: Project) => {
    setLaunchingId(project.id);
    try {
      const task = await startProjectReconstruction(project.id);
      if (task) {
        showToast(`Reconstruction started for "${project.name}"`, 'success');
        navigate(`/progress/${task.id}`);
      }
    } catch {
      showToast('Could not start reconstruction for this draft.', 'error');
    } finally {
      setLaunchingId(null);
    }
  };

  const handleCreateAndCopyShare = async (project: Project) => {
    if (demoMode) {
      const url = `${window.location.origin}/studio/${project.id}`;
      setLatestShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        showToast('Demo walkthrough link copied!', 'success');
      } catch {
        showToast(`Link ready: /studio/${project.id}`, 'info');
      }
      return;
    }

    setCreatingShare(true);
    try {
      const created = await api.createProjectShare(
        project.id,
        shareLabel.trim() || 'Client Walkthrough Link',
        72
      );
      const url = `${window.location.origin}${created.sharePath || `/shared/${created.shareToken}`}`;
      setLatestShareUrl(url);
      setShares((prev) => [created, ...prev]);
      try {
        await navigator.clipboard.writeText(url);
        showToast('Revocable client share link created & copied!', 'success');
      } catch {
        showToast('Revocable client share link created!', 'success');
      }
    } catch (err) {
      showToast(
        err instanceof Error && err.message ? err.message : 'Unable to create share link.',
        'error'
      );
    } finally {
      setCreatingShare(false);
    }
  };

  const handleRevokeShare = async (project: Project, shareId: string) => {
    try {
      await api.revokeProjectShare(project.id, shareId);
      setShares((prev) =>
        prev.map((s) => (s.shareId === shareId ? { ...s, isActive: false } : s))
      );
      showToast('Share link revoked', 'info');
    } catch (err) {
      showToast(
        err instanceof Error && err.message ? err.message : 'Unable to revoke share link.',
        'error'
      );
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || deleting) return;
    const target = confirmDelete;
    setDeleting(true);
    try {
      await deleteProject(target.id);
      setConfirmDelete(null);
      showToast(`Removed "${target.name}" from your atelier`, 'info');
    } catch {
      showToast(`Failed to delete "${target.name}".`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const filterTabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All Spaces' },
    { id: 'living', label: 'Living Rooms' },
    { id: 'kitchen', label: 'Kitchens' },
    { id: 'bedroom', label: 'Bedrooms' },
    { id: 'draft', label: 'Draft Scans' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      <AppHeader />

      <main className="w-full pt-28 pb-20 flex-1">
        <div className="max-w-7xl mx-auto px-6 sm:px-8">
          {/* Editorial Page Heading */}
          <div className="pt-6 pb-10 flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border-sand">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-container text-primary text-[11px] font-semibold tracking-wide uppercase mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {'Live Session Collection'}
              </div>
              <h1 className="font-headline text-4xl sm:text-5xl font-normal text-on-surface tracking-tight leading-tight">
                My Spaces
              </h1>
              <p className="mt-2.5 text-base sm:text-lg text-on-surface-variant font-light leading-relaxed">
                Interactive 3D rooms captured from your phone videos. Explore your reconstructed spaces from different viewpoints.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                to="/scan"
                className="px-6 py-3.5 rounded-full bg-primary hover:bg-primary-hover text-on-primary font-medium text-sm flex items-center gap-2.5 shadow-soft hover:shadow-hover transition-all duration-200 hover:-translate-y-0.5"
              >
                <span className="material-symbols-outlined text-[20px]">video_camera_front</span>
                <span>+ Scan New Room</span>
              </Link>
            </div>
          </div>

          {/* Controls, Filters & View Switcher */}
          <div className="py-7 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 lg:pb-0">
              {filterTabs.map((tab) => {
                const isActive = activeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveFilter(tab.id)}
                    className={`px-4 py-2 rounded-full text-xs transition-all whitespace-nowrap ${
                      isActive
                        ? 'font-semibold bg-on-surface text-surface shadow-sm'
                        : 'font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                    }`}
                  >
                    {tab.label}
                    {tab.id === 'all' && (
                      <span className="ml-1 opacity-70">({projects.length})</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              <div className="relative flex items-center bg-surface-container-low border border-border-sand rounded-full px-4 py-2 flex-1 sm:flex-initial sm:w-64 focus-within:border-primary/50 focus-within:bg-white transition-all">
                <span className="material-symbols-outlined text-outline text-[18px] mr-2">
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search your rooms..."
                  className="bg-transparent w-full text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="text-outline hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-[15px]">close</span>
                  </button>
                )}
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                aria-label="Sort rooms"
                className="bg-surface-container-low border border-border-sand rounded-full px-3.5 py-2 text-xs font-medium text-on-surface focus:outline-none focus:border-primary/50"
              >
                <option value="recent">Sort: Recent</option>
                <option value="name">Sort: Name A–Z</option>
              </select>

              <div className="flex items-center bg-surface-container-low border border-border-sand rounded-full p-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Grid Layout"
                  aria-label="Grid Layout"
                  className={`p-1.5 rounded-full transition-all flex items-center justify-center ${
                    viewMode === 'grid'
                      ? 'bg-white text-on-surface shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">grid_view</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  title="Editorial List"
                  aria-label="Editorial List"
                  className={`p-1.5 rounded-full transition-all flex items-center justify-center ${
                    viewMode === 'list'
                      ? 'bg-white text-on-surface shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">view_agenda</span>
                </button>
              </div>
            </div>
          </div>

          {/* Backend Error / Loading Notice in Live Mode */}
          {projectsError && !demoMode && (
            <div
              role="alert"
              className="mt-6 rounded-2xl bg-error-container border border-error/30 text-on-error-container px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-xs">
                <span className="material-symbols-outlined text-error text-[20px]">cloud_off</span>
                <div>
                  <p className="font-semibold">Unable to Load Projects from Backend</p>
                  <p className="mt-0.5">{projectsError}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void refreshProjects()}
                  className="px-4 py-2 rounded-full bg-error text-white text-xs font-semibold"
                >
                  Retry
                </button>
                <Link
                  to="/settings"
                  className="px-4 py-2 rounded-full bg-surface-container text-on-surface text-xs font-semibold"
                >
                  Settings
                </Link>
              </div>
            </div>
          )}

          {/* Spaces Gallery */}
          {projectsLoading && projects.length === 0 ? (
            <div className="text-center py-20 flex flex-col items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-primary animate-spin mb-3">
                progress_activity
              </span>
              <p className="text-sm text-on-surface-variant">Loading your 3D spaces...</p>
            </div>
          ) : filteredProjects.length > 0 ? (
            <div
              className={
                viewMode === 'grid'
                  ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8'
                  : 'flex flex-col gap-6'
              }
            >
              {filteredProjects.map((project) => {
                const isReady = project.status === 'ready';
                const isProcessing = project.status === 'processing';
                const isDraft = project.status === 'draft';
                const isFailed = project.status === 'failed';

                return (
                  <article
                    key={project.id}
                    className={`group bg-white border border-border-sand rounded-2xl overflow-hidden shadow-soft hover:shadow-hover transition-all duration-300 flex ${
                      viewMode === 'list' ? 'flex-col sm:flex-row' : 'flex-col'
                    }`}
                  >
                    <div
                      onClick={() => {
                        if (isProcessing && project.taskId) {
                          navigate(`/progress/${project.taskId}`);
                        } else if (isReady) {
                          navigate(`/studio/${project.id}`);
                        }
                      }}
                      className={`relative bg-surface-container-low overflow-hidden shrink-0 ${
                        isReady || isProcessing ? 'cursor-pointer' : ''
                      } ${
                        viewMode === 'list'
                          ? 'w-full sm:w-80 h-56 sm:h-auto'
                          : 'w-full h-64'
                      }`}
                    >
                      <SafeImage
                        src={project.thumbnailUrl}
                        alt={project.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                      />

                      <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-white/95 backdrop-blur-md border border-border-sand shadow-sm flex items-center gap-2">
                        {isReady && (
                          <>
                            <span className="w-2 h-2 rounded-full bg-emerald-600" />
                            <span className="text-[11px] font-semibold text-on-surface">
                              Ready to Explore
                            </span>
                          </>
                        )}
                        {isProcessing && (
                          <>
                            <span className="w-2 h-2 rounded-full bg-amber-600 animate-pulse" />
                            <span className="text-[11px] font-semibold text-amber-900">
                              Rendering {project.progress}%
                            </span>
                          </>
                        )}
                        {isDraft && (
                          <>
                            <span className="w-2 h-2 rounded-full bg-on-surface-variant" />
                            <span className="text-[11px] font-semibold text-on-surface-variant">
                              Video Recorded • Draft
                            </span>
                          </>
                        )}
                        {isFailed && (
                          <>
                            <span className="w-2 h-2 rounded-full bg-error" />
                            <span className="text-[11px] font-semibold text-error">
                              Reconstruction Error
                            </span>
                          </>
                        )}
                      </div>

                      <div className="absolute bottom-4 right-4 px-3 py-1 rounded-full bg-white/90 backdrop-blur-md text-[11px] font-medium text-on-surface-variant border border-border-sand">
                        {project.qualityBadge}
                      </div>
                    </div>

                    <div className="p-6 flex flex-col justify-between flex-1 gap-5 bg-white">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className={`text-[11px] uppercase tracking-wider font-semibold mb-1 ${
                              isProcessing
                                ? 'text-amber-800'
                                : isFailed
                                  ? 'text-error'
                                  : isDraft
                                    ? 'text-on-surface-variant'
                                    : 'text-primary'
                            }`}
                          >
                            {project.categoryLabel}
                          </div>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(project)}
                            title="Delete Space"
                            aria-label={`Delete ${project.name}`}
                            className="text-outline/60 hover:text-error p-1 -mt-1 -mr-1 rounded-full transition-colors"
                          >
                            <span className="material-symbols-outlined text-[17px]">
                              delete_outline
                            </span>
                          </button>
                        </div>

                        <h2 className="font-headline text-2xl font-normal text-on-surface group-hover:text-primary transition-colors">
                          {project.name}
                        </h2>
                        <p className="mt-1 text-xs text-on-surface-variant font-light line-clamp-2">
                          {project.description}
                        </p>
                      </div>

                      {isProcessing && (
                        <div className="w-full flex flex-col gap-1.5">
                          <div className="flex justify-between text-[11px] font-medium text-on-surface-variant">
                            <span>Reconstructing captured room geometry</span>
                            <span>{project.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500"
                              style={{ width: `${project.progress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="pt-2 flex items-center gap-2 border-t border-border-sand/60">
                        {isReady && (
                          <>
                            <Link
                              to={`/studio/${project.id}`}
                              className="flex-1 py-2.5 px-4 rounded-full bg-primary hover:bg-primary-hover text-on-primary font-medium text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                visibility
                              </span>
                              <span>Step Inside 3D</span>
                            </Link>

                          </>
                        )}

                        {isProcessing && (
                          <>
                            <Link
                              to={project.taskId ? `/progress/${project.taskId}` : '/progress'}
                              className="flex-1 py-2.5 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-medium text-xs flex items-center justify-center gap-1.5 transition-all"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                visibility
                              </span>
                              <span>Live Progress</span>
                            </Link>

                          </>
                        )}

                        {(isDraft || isFailed) && (
                          <>
                            <button
                              type="button"
                              disabled={launchingId === project.id}
                              onClick={() => handleGenerateDraft(project)}
                              className="flex-1 py-2.5 px-4 rounded-full bg-primary hover:bg-primary-hover text-on-primary font-medium text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all disabled:opacity-60"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                play_arrow
                              </span>
                              <span>
                                {launchingId === project.id
                                  ? 'Starting...'
                                  : isFailed
                                    ? 'Retry 3D Room'
                                    : 'Generate 3D Room'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setFramesProject(project)}
                              title="Review captured frames"
                              className="py-2.5 px-3 rounded-full bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface font-medium text-xs flex items-center gap-1 border border-border-sand transition-all"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                collections
                              </span>
                              <span className="hidden sm:inline">Frames</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => setShareProject(project)}
                          title="Share Space Link"
                          aria-label={`Share ${project.name}`}
                          className="p-2.5 rounded-full bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface border border-border-sand transition-all"
                        >
                          <span className="material-symbols-outlined text-[16px]">ios_share</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20 flex flex-col items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-outline mb-3">
                cottage
              </span>
              <h3 className="font-headline text-2xl text-on-surface">
                {projects.length === 0
                  ? 'No 3D spaces in this session yet'
                  : 'No rooms matched your search'}
              </h3>
              <p className="text-sm text-on-surface-variant font-light mt-1">
                {projects.length === 0
                  ? 'Upload a room walkthrough video to reconstruct your first 3D Gaussian Splat scene.'
                  : 'Try another keyword or filter by room type above.'}
              </p>
              {projects.length === 0 ? (
                <Link
                  to="/scan"
                  className="mt-5 px-6 py-2.5 rounded-full bg-primary text-on-primary text-xs font-semibold transition-colors"
                >
                  + Scan New Room
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter('all');
                    setSearchQuery('');
                  }}
                  className="mt-5 px-5 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-colors"
                >
                  Reset Filters
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      <AppFooter />

      {/* Share Modal */}
      <AtelierModal
        open={Boolean(shareProject)}
        onClose={() => setShareProject(null)}
        title={shareProject ? `Share "${shareProject.name}"` : 'Share Space'}
        subtitle="Browser-ready 3D Gaussian Splat walkthrough link"
        icon="ios_share"
      >
        {shareProject && (
          <div className="space-y-4 text-xs">
            <p className="text-on-surface-variant">
              {'Generate a revocable read-only link so clients can explore this 3D room in any browser without signing in.'}
            </p>

            {!demoMode && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={shareLabel}
                  onChange={(e) => setShareLabel(e.target.value)}
                  placeholder="Share label (e.g. Client Review)"
                  aria-label="Share label"
                  className="flex-1 px-3.5 py-2 rounded-xl bg-surface-container-low border border-border-sand text-xs text-on-surface focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  disabled={creatingShare}
                  onClick={() => void handleCreateAndCopyShare(shareProject)}
                  className="px-4 py-2 rounded-full bg-primary text-white font-semibold hover:bg-primary-hover transition-colors disabled:opacity-60 shrink-0"
                >
                  {creatingShare ? 'Creating...' : 'Create & Copy Share Link'}
                </button>
              </div>
            )}

            {latestShareUrl && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-container-low border border-border-sand">
                <input
                  readOnly
                  value={latestShareUrl}
                  aria-label="Shareable walkthrough URL"
                  className="flex-1 bg-transparent text-xs text-on-surface focus:outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(latestShareUrl).then(() => {
                      showToast('Link copied to clipboard!', 'success');
                    });
                  }}
                  className="px-4 py-1.5 rounded-full bg-primary text-white font-semibold hover:bg-primary-hover transition-colors"
                >
                  Copy
                </button>
              </div>
            )}

            {!demoMode && (
              <div className="space-y-2 pt-2 border-t border-border-sand/70">
                <p className="font-semibold text-on-surface">Issued Share Links</p>
                {sharesLoading ? (
                  <p className="text-on-surface-variant">Loading shares...</p>
                ) : shares.length === 0 ? (
                  <p className="text-on-surface-variant">No share links issued yet.</p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {shares.map((s) => (
                      <div
                        key={s.shareId}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-container-low border border-border-sand/60"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-on-surface truncate">{s.label}</p>
                          <p className="text-[11px] text-on-surface-variant">
                            {s.isActive ? 'Active' : 'Revoked / Expired'} • Expires{' '}
                            {new Date(s.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        {s.isActive && (
                          <button
                            type="button"
                            onClick={() => void handleRevokeShare(shareProject, s.shareId)}
                            className="px-3 py-1 rounded-full bg-error-container text-error font-semibold hover:opacity-80 shrink-0"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </AtelierModal>

      {/* Draft Frames Modal */}
      <AtelierModal
        open={Boolean(framesProject)}
        onClose={() => setFramesProject(null)}
        title={framesProject ? `Captured Frames — ${framesProject.name}` : 'Frames'}
        subtitle="Sampled at 2 fps • Capped at 960px long side • Blur filtered"
        icon="collections"
      >
        {framesProject && (
          <div className="space-y-4">
            {(
              <div className="rounded-xl border border-border-sand bg-surface-container-low p-4 text-xs space-y-1.5">
                <p className="font-semibold text-on-surface">
                  Video: {framesProject.videoFileName || 'Not yet uploaded'}
                </p>
                <p className="text-on-surface-variant">
                  {framesProject.videoReady
                    ? `Validated upload (${framesProject.videoWidth || '?'}×${
                        framesProject.videoHeight || '?'
                      }, ${Math.round(framesProject.videoDurationSec || 0)}s) — frames will be extracted when reconstruction runs.`
                    : 'Upload a walkthrough video on Scan Room before launching reconstruction.'}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFramesProject(null)}
                className="px-4 py-2 rounded-full bg-surface-container text-xs font-medium"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = framesProject;
                  setFramesProject(null);
                  void handleGenerateDraft(target);
                }}
                className="px-5 py-2 rounded-full bg-primary text-white text-xs font-semibold"
              >
                Generate 3D Room Now
              </button>
            </div>
          </div>
        )}
      </AtelierModal>

      {/* Delete Confirmation Modal */}
      <AtelierModal
        open={Boolean(confirmDelete)}
        onClose={() => {
          if (!deleting) setConfirmDelete(null);
        }}
        title="Remove Space?"
        subtitle="This removes the room and its splat bundle from your catalog"
        icon="delete_outline"
      >
        {confirmDelete && (
          <div className="space-y-4 text-xs">
            <p className="text-on-surface-variant leading-relaxed">
              Are you sure you want to delete{' '}
              <strong className="text-on-surface">{confirmDelete.name}</strong>? You can always
              re-upload your walkthrough video later.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-full bg-surface-container text-on-surface font-medium disabled:opacity-50"
              >
                Keep Space
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="px-5 py-2 rounded-full bg-error text-white font-semibold hover:opacity-90 disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Delete Space'}
              </button>
            </div>
          </div>
        )}
      </AtelierModal>
    </div>
  );
};
