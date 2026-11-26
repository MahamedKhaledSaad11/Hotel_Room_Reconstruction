import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  PipelineStageId,
  Project,
  ReconstructionTask,
  VideoConstraintsConfig,
} from '../types';
import { INITIAL_PROJECTS, INITIAL_TASKS } from '../data/mockData';
import {
  api,
  getApiBaseUrl,
  isDemoMode,
  safeReadJson,
  safeWriteJson,
  STORAGE_KEYS,
} from '../services/api';
import { useAuth } from './AuthContext';

interface ProjectsContextValue {
  projects: Project[];
  tasks: Record<string, ReconstructionTask>;
  activeTaskId: string;
  projectsLoading: boolean;
  projectsError: string | null;
  refreshProjects: () => Promise<void>;
  createAndLaunchRoom: (
    file: File | null,
    config: VideoConstraintsConfig,
    existingProjectId?: string
  ) => Promise<{ project: Project; task: ReconstructionTask }>;
  createDraftProject: (config: VideoConstraintsConfig) => Promise<Project>;
  uploadAndReconstructProject: (
    project: Project,
    file: File | null,
    config: VideoConstraintsConfig
  ) => Promise<{ project: Project; task: ReconstructionTask }>;
  startProjectReconstruction: (projectId: string) => Promise<ReconstructionTask | null>;
  deleteProject: (projectId: string) => Promise<void>;
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  cancelTask: (taskId: string) => Promise<void>;
  fastForwardTask: (taskId: string) => void;
  markProjectRestyled: (projectId: string, objectLabel: string) => void;
  refreshTaskFromBackend: (taskId: string) => Promise<ReconstructionTask | null>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

const STAGE_MESSAGES: Record<PipelineStageId, string[]> = {
  extracting_frames: [
    'Decoding video stream and extracting key viewpoints...',
    'Resizing frames to capped 960px long side & dropping blurry motion frames...',
  ],
  estimating_poses: [
    'Running sequential feature matching across room loop...',
    'Solving global SfM poses & exporting COLMAP sparse/0...',
  ],
  training_3dgs: [
    'Initializing 3D Gaussian primitives from sparse point cloud...',
    'Simulating daylight ray dispersion & Gaussian densification...',
    'Balancing sunbeams on oak wood & linen surfaces...',
  ],
  exporting_splat: [
    'Pruning low-opacity splats & exporting .ply -> compact .splat...',
    'Finalizing browser-ready 3D room bundle...',
  ],
};

function loadInitialDemoProjects(): Project[] {
  const parsed = safeReadJson<Project[] | null>(STORAGE_KEYS.projects, null);
  return Array.isArray(parsed) ? parsed : INITIAL_PROJECTS;
}

function loadInitialDemoTasks(): Record<string, ReconstructionTask> {
  const parsed = safeReadJson<Record<string, ReconstructionTask>>(STORAGE_KEYS.tasks, {});
  return { ...INITIAL_TASKS, ...parsed };
}

function stageForProgress(pct: number): PipelineStageId {
  if (pct < 25) return 'extracting_frames';
  if (pct < 50) return 'estimating_poses';
  if (pct < 88) return 'training_3dgs';
  return 'exporting_splat';
}

function isActiveTaskStatus(status: ReconstructionTask['status']): boolean {
  return status === 'queued' || status === 'running';
}

export const ProjectsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings, demoMode, isAuthenticated, authChecking, sessionId } = useAuth();
  const [projects, setProjects] = useState<Project[]>(() =>
    demoMode ? loadInitialDemoProjects() : []
  );
  const [tasks, setTasks] = useState<Record<string, ReconstructionTask>>(() =>
    demoMode ? loadInitialDemoTasks() : {}
  );
  const [projectsLoading, setProjectsLoading] = useState<boolean>(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const tickRef = useRef<number | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // Persist demo state ONLY in Demo Mode (never mix demo localStorage into Live Mode)
  useEffect(() => {
    if (demoMode) {
      safeWriteJson(STORAGE_KEYS.projects, projects);
    }
  }, [projects, demoMode]);

  useEffect(() => {
    if (demoMode) {
      safeWriteJson(STORAGE_KEYS.tasks, tasks);
    }
  }, [tasks, demoMode]);

  const refreshProjects = useCallback(async () => {
    if (isDemoMode()) {
      setProjects(loadInitialDemoProjects());
      setTasks(loadInitialDemoTasks());
      setProjectsError(null);
      return;
    }

    const baseUrl = settings.apiBaseUrl.trim() || getApiBaseUrl();
    if (!baseUrl) {
      setProjects([]);
      setTasks({});
      setProjectsError(
        'Live Mode is active, but no FastAPI Backend URL is configured in Settings.'
      );
      return;
    }

    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const remote = await api.getProjects();
      setProjects(remote);
      // Enrich / hydrate active tasks for any processing projects
      const activeIds = remote
        .map((p) => p.taskId)
        .filter((tid): tid is string => Boolean(tid));
      if (activeIds.length > 0) {
        const fetched = await Promise.all(
          activeIds.map(async (tid) => {
            try {
              const t = await api.getTask(tid);
              if (!t) return null;
              const ownerProj = remote.find((p) => p.id === t.projectId);
              return ownerProj ? { ...t, projectName: ownerProj.name } : t;
            } catch {
              return null;
            }
          })
        );
        setTasks((prev) => {
          const next = { ...prev };
          for (const t of fetched) {
            if (t) next[t.id] = t;
          }
          return next;
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to load projects from FastAPI backend.';
      setProjectsError(msg);
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, [settings.apiBaseUrl]);

  // Switch cleanly between Live Mode and Demo Mode when mode, URL, auth, or session changes
  useEffect(() => {
    if (demoMode) {
      setProjects(loadInitialDemoProjects());
      setTasks(loadInitialDemoTasks());
      setProjectsError(null);
      setProjectsLoading(false);
      return;
    }
    if (authChecking) return;
    if (!isAuthenticated) {
      setProjects([]);
      setTasks({});
      setProjectsError(null);
      setProjectsLoading(false);
      return;
    }
    setTasks({});
    void refreshProjects();
  }, [demoMode, settings.apiBaseUrl, isAuthenticated, authChecking, sessionId, refreshProjects]);

  // Sync task states (progress, completed, cancelled, failed/error) into projects cleanly
  useEffect(() => {
    const taskList = Object.values(tasks);
    if (taskList.length === 0) return;

    setProjects((projPrev) => {
      let changed = false;
      const nextProjects = projPrev.map((p) => {
        const matchingTask =
          (p.taskId ? tasks[p.taskId] : undefined) ||
          taskList
            .filter((t) => t.projectId === p.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

        if (!matchingTask) return p;

        if (matchingTask.status === 'completed' && p.status !== 'ready') {
          changed = true;
          const gaussLabel =
            matchingTask.gaussiansCount > 0
              ? `${matchingTask.gaussiansCount.toLocaleString()} Gaussians`
              : p.splatCountLabel;
          return {
            ...p,
            status: 'ready' as const,
            progress: 100,
            estimatedMinutesLeft: 0,
            scannedAtLabel: 'Ready',
            frameCount: matchingTask.registeredFrames || p.frameCount,
            splatCountLabel: gaussLabel,
          };
        }

        if (matchingTask.status === 'cancelled' && p.status === 'processing') {
          changed = true;
          return {
            ...p,
            status: 'draft' as const,
            progress: 0,
            scannedAtLabel: 'Cancelled Draft',
          };
        }

        if (
          (matchingTask.status === 'failed' || matchingTask.status === 'error') &&
          p.status === 'processing'
        ) {
          changed = true;
          return {
            ...p,
            status: 'failed' as const,
            scannedAtLabel: 'Pipeline Error',
          };
        }

        if (
          isActiveTaskStatus(matchingTask.status) &&
          p.status === 'processing' &&
          p.progress !== matchingTask.progress
        ) {
          changed = true;
          return {
            ...p,
            progress: matchingTask.progress,
            estimatedMinutesLeft: Math.max(1, Math.ceil((100 - matchingTask.progress) / 25)),
          };
        }

        return p;
      });
      return changed ? nextProjects : projPrev;
    });
  }, [tasks]);

  // Poll BOTH queued and running tasks in Live Mode; simulate locally ONLY in Demo Mode
  useEffect(() => {
    tickRef.current = window.setInterval(() => {
      if (!demoMode) {
        const activeTasks = Object.values(tasksRef.current).filter((t) =>
          isActiveTaskStatus(t.status)
        );
        activeTasks.forEach((localT) => {
          void api
            .getTask(localT.id)
            .then((remote) => {
              if (!remote) return;
              const projName =
                projectsRef.current.find((p) => p.id === remote.projectId)?.name ||
                localT.projectName;
              setTasks((prev) => ({
                ...prev,
                [localT.id]: { ...remote, projectName: projName },
              }));
              if (remote.status === 'completed') {
                void api
                  .getProject(remote.projectId)
                  .then((freshProj) => {
                    setProjects((prev) =>
                      prev.map((p) => (p.id === freshProj.id ? freshProj : p))
                    );
                  })
                  .catch(() => {
                    // Ignore transient refresh error
                  });
              }
            })
            .catch(() => {
              // Ignore transient poll errors; keep polling until terminal state
            });
        });
        return;
      }

      // Demo Mode local progress simulation
      setTasks((prev) => {
        let changed = false;
        const next = { ...prev };

        for (const [id, task] of Object.entries(prev)) {
          if (task.status !== 'running') continue;
          changed = true;
          const nextPct = Math.min(100, task.progress + 2);
          const nextStage = stageForProgress(nextPct);
          const stageMsgs = STAGE_MESSAGES[nextStage];
          const msg = stageMsgs[Math.floor((nextPct / 10) % stageMsgs.length)];
          const isComplete = nextPct >= 100;

          const nextLogs = [...task.logs];
          if (nextPct >= 26 && !nextLogs.some((l) => l.includes('registered'))) {
            nextLogs.push(
              `[00:28] ${task.poseEstimator.toLowerCase()}: registered ${Math.max(
                task.extractedFrames - 4,
                1
              )}/${task.extractedFrames} cameras to COLMAP sparse/0`
            );
          }
          if (nextPct >= 52 && !nextLogs.some((l) => l.includes('gsplat: initialized'))) {
            nextLogs.push(
              `[00:54] gsplat: initialized 162,400 sparse points on CUDA T4 (fp16)`
            );
          }
          if (nextPct >= 88 && !nextLogs.some((l) => l.includes('exporter:'))) {
            nextLogs.push(
              `[02:18] exporter: exporting .ply -> compact .splat (4.2M Gaussians, 41.6 MB)`
            );
          }
          if (isComplete && !nextLogs.some((l) => l.includes('pipeline complete'))) {
            nextLogs.push(`[02:34] pipeline complete: 3D Gaussian Splat room ready for walkthrough`);
          }

          next[id] = {
            ...task,
            progress: nextPct,
            stage: nextStage,
            status: isComplete ? 'completed' : 'running',
            estimatedMinutes: isComplete ? 0 : Math.max(1, Math.ceil((100 - nextPct) / 25)),
            substepMessage: isComplete ? '3D room reconstruction complete!' : msg,
            registeredFrames:
              nextPct >= 25
                ? Math.max(task.extractedFrames - 4, 1)
                : Math.round((nextPct / 25) * task.extractedFrames),
            iterationsDone:
              nextPct >= 50
                ? Math.min(
                    task.iterationsTotal,
                    Math.round(((nextPct - 50) / 38) * task.iterationsTotal)
                  )
                : 0,
            gaussiansCount:
              nextPct >= 50
                ? Math.round(((nextPct - 45) / 55) * 4200000)
                : task.gaussiansCount,
            logs: nextLogs,
          };
        }

        return changed ? next : prev;
      });
    }, 2400);

    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
      }
    };
  }, [demoMode]);

  const createDraftProject = useCallback(async (config: VideoConstraintsConfig) => {
    const project = await api.createProject(config);
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
    return project;
  }, []);

  const uploadAndReconstructProject = useCallback(
    async (project: Project, file: File | null, config: VideoConstraintsConfig) => {
      const uploadRes = await api.uploadVideo(project.id, file, config);
      const updatedProject: Project = {
        ...project,
        videoReady: true,
        videoFileName: uploadRes.details?.videoFilename ?? config.videoFileName,
        videoDurationSec: uploadRes.details?.durationSec ?? config.videoDurationSec,
        videoWidth: uploadRes.details?.width ?? config.videoWidth,
        videoHeight: uploadRes.details?.height ?? config.videoHeight,
        frameCount: uploadRes.frameEstimate || project.frameCount,
      };
      setProjects((prev) =>
        prev.map((p) => (p.id === updatedProject.id ? updatedProject : p))
      );

      const task = await api.startReconstruction(updatedProject, config);

      const processingProject: Project = {
        ...updatedProject,
        status: 'processing',
        progress: task.progress,
        taskId: task.id,
        estimatedMinutesLeft: task.estimatedMinutes,
        scannedAtLabel: task.status === 'queued' ? 'Queued' : 'Processing',
      };

      setProjects((prev) => [
        processingProject,
        ...prev.filter((p) => p.id !== processingProject.id),
      ]);
      setTasks((prev) => ({ ...prev, [task.id]: task }));

      return { project: processingProject, task };
    },
    []
  );

  const createAndLaunchRoom = useCallback(
    async (
      file: File | null,
      config: VideoConstraintsConfig,
      existingProjectId?: string
    ) => {
      let project: Project | undefined = existingProjectId
        ? projectsRef.current.find((p) => p.id === existingProjectId)
        : undefined;
      if (!project) {
        project = await createDraftProject(config);
      }
      return await uploadAndReconstructProject(project, file, config);
    },
    [createDraftProject, uploadAndReconstructProject]
  );

  const startProjectReconstruction = useCallback(
    async (projectId: string) => {
      const target = projectsRef.current.find((p) => p.id === projectId);
      if (!target) return null;
      const task = await api.startReconstruction(target);
      setTasks((prev) => ({ ...prev, [task.id]: task }));
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                status: 'processing',
                progress: task.progress,
                taskId: task.id,
                estimatedMinutesLeft: task.estimatedMinutes,
              }
            : p
        )
      );
      return task;
    },
    []
  );

  const deleteProject = useCallback(async (projectId: string) => {
    await api.deleteProject(projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setTasks((prev) => {
      const next: Record<string, ReconstructionTask> = {};
      for (const [id, task] of Object.entries(prev)) {
        if (task.projectId !== projectId) {
          next[id] = task;
        }
      }
      return next;
    });
  }, []);

  const pauseTask = useCallback((taskId: string) => {
    if (!isDemoMode()) return;
    setTasks((prev) => {
      const t = prev[taskId];
      if (!t || t.status !== 'running') return prev;
      return {
        ...prev,
        [taskId]: {
          ...t,
          status: 'paused',
          substepMessage: 'Reconstruction paused by designer.',
          logs: [...t.logs, '[paused] Pipeline paused by user'],
        },
      };
    });
  }, []);

  const resumeTask = useCallback((taskId: string) => {
    if (!isDemoMode()) return;
    setTasks((prev) => {
      const t = prev[taskId];
      if (!t || t.status !== 'paused') return prev;
      return {
        ...prev,
        [taskId]: {
          ...t,
          status: 'running',
          substepMessage: STAGE_MESSAGES[t.stage][0],
          logs: [...t.logs, '[resumed] Resuming GPU pipeline worker'],
        },
      };
    });
  }, []);

  const cancelTask = useCallback(async (taskId: string) => {
    if (!isDemoMode()) {
      const cancelled = await api.cancelTask(taskId);
      if (cancelled) {
        const projName =
          projectsRef.current.find((p) => p.id === cancelled.projectId)?.name ||
          tasksRef.current[taskId]?.projectName ||
          cancelled.projectId;
        setTasks((prev) => ({
          ...prev,
          [taskId]: { ...cancelled, projectName: projName },
        }));
      }
      return;
    }
    setTasks((prev) => {
      const t = prev[taskId];
      if (!t) return prev;
      return {
        ...prev,
        [taskId]: {
          ...t,
          status: 'cancelled',
          substepMessage: 'Scan cancelled — saved as video draft.',
          logs: [...t.logs, '[cancelled] Task cancelled; uploaded frames preserved as draft'],
        },
      };
    });
  }, []);

  const fastForwardTask = useCallback((taskId: string) => {
    if (!isDemoMode()) return;
    setTasks((prev) => {
      const t = prev[taskId];
      if (!t) return prev;
      return {
        ...prev,
        [taskId]: {
          ...t,
          status: 'completed',
          stage: 'exporting_splat',
          progress: 100,
          estimatedMinutes: 0,
          registeredFrames: t.extractedFrames,
          iterationsDone: t.iterationsTotal,
          gaussiansCount: 4200000,
          substepMessage: '3D Gaussian Splat room ready for walkthrough!',
          logs: [
            ...t.logs,
            '[fast-complete] 15,000 / 15,000 iterations complete — exported .splat (4.2M Gaussians)',
          ],
        },
      };
    });
  }, []);

  const markProjectRestyled = useCallback((projectId: string, objectLabel: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              hasRestyle: true,
              restyledObjectLabel: objectLabel,
              hasEditedScene: true,
            }
          : p
      )
    );
  }, []);

  const refreshTaskFromBackend = useCallback(async (taskId: string) => {
    const remote = await api.getTask(taskId);
    if (remote) {
      let projectName =
        projectsRef.current.find((p) => p.id === remote.projectId)?.name ||
        tasksRef.current[taskId]?.projectName;
      if (!projectName && !isDemoMode()) {
        try {
          const proj = await api.getProject(remote.projectId);
          projectName = proj.name;
          setProjects((prev) => {
            const exists = prev.some((p) => p.id === proj.id);
            return exists
              ? prev.map((p) => (p.id === proj.id ? proj : p))
              : [proj, ...prev];
          });
        } catch {
          projectName = remote.projectId;
        }
      }
      const hydrated = {
        ...remote,
        projectName: projectName || remote.projectName,
      };
      setTasks((prev) => ({ ...prev, [taskId]: hydrated }));
      return hydrated;
    }
    return null;
  }, []);

  const activeTaskId =
    Object.values(tasks).find((t) => isActiveTaskStatus(t.status) || t.status === 'paused')
      ?.id ||
    Object.keys(tasks)[0] ||
    '';

  return (
    <ProjectsContext.Provider
      value={{
        projects,
        tasks,
        activeTaskId,
        projectsLoading,
        projectsError,
        refreshProjects,
        createAndLaunchRoom,
        createDraftProject,
        uploadAndReconstructProject,
        startProjectReconstruction,
        deleteProject,
        pauseTask,
        resumeTask,
        cancelTask,
        fastForwardTask,
        markProjectRestyled,
        refreshTaskFromBackend,
      }}
    >
      {children}
    </ProjectsContext.Provider>
  );
};

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectsProvider');
  return ctx;
}
