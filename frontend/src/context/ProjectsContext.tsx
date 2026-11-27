import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  Project,
  ReconstructionTask,
  VideoConstraintsConfig,
} from '../types';
import { api } from '../services/api';
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
  startProjectReconstruction: (
    projectId: string
  ) => Promise<ReconstructionTask | null>;
  deleteProject: (projectId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  refreshTaskFromBackend: (
    taskId: string
  ) => Promise<ReconstructionTask | null>;
}
const ProjectsContext = createContext<ProjectsContextValue | null>(null);
const active = (task: ReconstructionTask) =>
  task.status === 'queued' || task.status === 'running';

export const ProjectsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { settings, isAuthenticated, authChecking, sessionId } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Record<string, ReconstructionTask>>({});
  const [projectsLoading, setLoading] = useState(false);
  const [projectsError, setError] = useState<string | null>(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const generation = useRef(0);
  const upsert = useCallback(
    (project: Project) =>
      setProjects((previous) => [
        project,
        ...previous.filter((item) => item.id !== project.id),
      ]),
    []
  );
  const refreshProjects = useCallback(async () => {
    const current = generation.current;
    setLoading(true);
    setError(null);
    try {
      const remote = await api.getProjects();
      if (current !== generation.current) return;
      setProjects(remote);
      const ids = [
        ...new Set(
          remote
            .map((project) => project.taskId)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      const loaded = await Promise.all(
        ids.map((id) => api.getTask(id).catch(() => null))
      );
      if (current !== generation.current) return;
      setTasks((previous) => {
        const next = { ...previous };
        for (const task of loaded) {
          if (task)
            next[task.id] = {
              ...task,
              projectName:
                remote.find((project) => project.id === task.projectId)?.name ||
                task.projectName,
            };
        }
        return next;
      });
    } catch (error) {
      if (current === generation.current)
        setError(
          error instanceof Error ? error.message : 'Unable to load your spaces.'
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    generation.current++;
    setProjects([]);
    setTasks({});
    setError(null);
    setLoading(false);
    if (!authChecking && isAuthenticated) void refreshProjects();
    return () => {
      generation.current++;
    };
  }, [
    isAuthenticated,
    authChecking,
    sessionId,
    settings.apiBaseUrl,
    refreshProjects,
  ]);
  const refreshTaskFromBackend = useCallback(
    async (taskId: string) => {
      const current = generation.current;
      const task = await api.getTask(taskId);
      if (!task || current !== generation.current) return null;
      let project = projectsRef.current.find(
        (item) => item.id === task.projectId
      );
      if (!project || task.status === 'completed') {
        try {
          project = await api.getProject(task.projectId);
          if (current === generation.current) upsert(project);
        } catch {
          /* Keep the valid task response during a transient project refresh failure. */
        }
      }
      if (current !== generation.current) return null;
      const hydrated = {
        ...task,
        projectName: project?.name || task.projectName,
      };
      setTasks((previous) => ({ ...previous, [taskId]: hydrated }));
      return hydrated;
    },
    [upsert]
  );
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false,
      timer: number | undefined;
    const poll = async () => {
      await Promise.all(
        Object.values(tasksRef.current)
          .filter(active)
          .map((task) => refreshTaskFromBackend(task.id).catch(() => null))
      );
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2400);
    };
    timer = window.setTimeout(() => void poll(), 2400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isAuthenticated, sessionId, refreshTaskFromBackend]);
  useEffect(() => {
    setProjects((previous) =>
      previous.map((project) => {
        const task = project.taskId ? tasks[project.taskId] : undefined;
        if (!task) return project;
        const status: Project['status'] =
          task.status === 'completed'
            ? 'ready'
            : task.status === 'failed' || task.status === 'error'
              ? 'failed'
              : task.status === 'cancelled'
                ? 'draft'
                : active(task)
                  ? 'processing'
                  : project.status;
        const progress = task.status === 'completed' ? 100 : task.progress;
        if (project.status === status && project.progress === progress)
          return project;
        return {
          ...project,
          status,
          progress,
          frameCount: task.registeredFrames || project.frameCount,
          splatCountLabel: task.gaussiansCount
            ? `${task.gaussiansCount.toLocaleString()} Gaussians`
            : project.splatCountLabel,
        };
      })
    );
  }, [tasks]);
  const createDraftProject = useCallback(
    async (config: VideoConstraintsConfig) => {
      const project = await api.createProject(config);
      upsert(project);
      return project;
    },
    [upsert]
  );
  const uploadAndReconstructProject = useCallback(
    async (
      project: Project,
      file: File | null,
      config: VideoConstraintsConfig
    ) => {
      const upload = await api.uploadVideo(project.id, file, config);
      const uploaded = {
        ...project,
        videoReady: true,
        videoFileName: upload.details?.videoFilename || config.videoFileName,
        videoDurationSec:
          upload.details?.durationSec || config.videoDurationSec,
        videoWidth: upload.details?.width || config.videoWidth,
        videoHeight: upload.details?.height || config.videoHeight,
        frameCount: upload.frameEstimate || project.frameCount,
      };
      upsert(uploaded);
      const task = await api.startReconstruction(uploaded, config);
      const processing: Project = {
        ...uploaded,
        status: 'processing',
        progress: task.progress,
        taskId: task.id,
        scannedAtLabel: task.status === 'queued' ? 'Queued' : 'Processing',
      };
      upsert(processing);
      setTasks((previous) => ({ ...previous, [task.id]: task }));
      return { project: processing, task };
    },
    [upsert]
  );
  const createAndLaunchRoom = useCallback(
    async (
      file: File | null,
      config: VideoConstraintsConfig,
      existingProjectId?: string
    ) => {
      const existing = existingProjectId
        ? projectsRef.current.find(
            (project) => project.id === existingProjectId
          )
        : undefined;
      const project = existing || (await createDraftProject(config));
      return uploadAndReconstructProject(project, file, config);
    },
    [createDraftProject, uploadAndReconstructProject]
  );
  const startProjectReconstruction = useCallback(
    async (projectId: string) => {
      const project = projectsRef.current.find((item) => item.id === projectId);
      if (!project) return null;
      const task = await api.startReconstruction(project);
      setTasks((previous) => ({ ...previous, [task.id]: task }));
      upsert({
        ...project,
        status: 'processing',
        progress: task.progress,
        taskId: task.id,
      });
      return task;
    },
    [upsert]
  );
  const deleteProject = useCallback(async (projectId: string) => {
    await api.deleteProject(projectId);
    setProjects((previous) =>
      previous.filter((project) => project.id !== projectId)
    );
    setTasks((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([, task]) => task.projectId !== projectId
        )
      )
    );
  }, []);
  const cancelTask = useCallback(async (taskId: string) => {
    const task = await api.cancelTask(taskId);
    if (task) setTasks((previous) => ({ ...previous, [taskId]: task }));
  }, []);
  const activeTaskId =
    Object.values(tasks).find(active)?.id || Object.keys(tasks)[0] || '';
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
        cancelTask,
        refreshTaskFromBackend,
      }}
    >
      {children}
    </ProjectsContext.Provider>
  );
};
export function useProjects(): ProjectsContextValue {
  const value = useContext(ProjectsContext);
  if (!value)
    throw new Error('useProjects must be used within ProjectsProvider');
  return value;
}
