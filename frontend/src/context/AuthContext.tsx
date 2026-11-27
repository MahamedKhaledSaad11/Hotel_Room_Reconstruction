import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AtelierSettings, UserPracticeRole, UserProfile } from '../types';
import { INITIAL_USER } from '../data/mockData';
import {
  api,
  getApiBaseUrl,
  getOrCreateSessionId,
  getStoredSettings,
  rotateSessionId,
  safeReadJson,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
  safeWriteJson,
  saveStoredSettings,
  setOnUnauthorizedCallback,
  STORAGE_KEYS,
} from '../services/api';
import { useToast } from './ToastContext';

const BLANK_LIVE_USER: UserProfile = {
  id: '',
  fullName: '',
  email: '',
  title: 'Atelier Member',
  studioName: '',
  practiceFocus: 'Interior Architecture & Luxury Residential',
  role: 'Interior Designer',
  accountRole: 'member',
  permissions: [],
  avatarUrl: '',
  licenseId: '',
  location: '',
  memberSince: '',
  primaryRig: '',
};

interface AuthContextValue {
  user: UserProfile;
  isAuthenticated: boolean;
  authChecking: boolean;
  demoMode: boolean;
  sessionId: string;
  recoveryEmail: string;
  settings: AtelierSettings;
  signIn: (
    email: string,
    password: string,
    remember?: boolean
  ) => Promise<void>;
  signUp: (payload: {
    fullName: string;
    email: string;
    password: string;
    role: UserPracticeRole;
  }) => Promise<void>;
  signInWithDemoProvider: (
    provider: 'Google' | 'Apple' | 'Studio SAML'
  ) => void;
  enterDemoSandbox: () => void;
  signOut: () => void;
  requestPasswordReset: (email: string) => Promise<string | undefined>;
  completePasswordReset: (newPassword: string, token?: string) => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<void>;
  updateSettings: (updates: Partial<AtelierSettings>) => void;
  setDemoMode: (enabled: boolean) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readDemoUser(): UserProfile {
  const stored = safeReadJson<Partial<UserProfile>>(
    STORAGE_KEYS.user,
    INITIAL_USER
  );
  return {
    ...INITIAL_USER,
    accountRole: 'member',
    permissions: [
      'project:read',
      'project:write',
      'project:delete',
      'project:share',
      'profile:write',
    ],
    ...stored,
  };
}

function computeDemoMode(_s: AtelierSettings): boolean {
  return false;
}

function isDemoToken(token: string | null): boolean {
  if (!token) return false;
  return (
    token.startsWith('atelier-demo-') || token.startsWith('atelier-oauth-')
  );
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { showToast } = useToast();
  const [sessionId, setSessionId] = useState<string>(() => {
    // Purge legacy v1 demo settings/tokens so returning browsers never enter stale demo mode
    safeStorageRemove('auraspace_settings_v1');
    safeStorageRemove('auraspace_user_v1');
    const existingTok = safeStorageGet(STORAGE_KEYS.token);
    if (isDemoToken(existingTok)) {
      safeStorageRemove(STORAGE_KEYS.token);
    }
    return getOrCreateSessionId();
  });
  const [settings, setSettings] = useState<AtelierSettings>(() => {
    const initial = getStoredSettings();
    return {
      ...initial,
      demoMode: false,
    };
  });

  const demoMode = computeDemoMode(settings);

  const [user, setUser] = useState<UserProfile>(BLANK_LIVE_USER);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authChecking, setAuthChecking] = useState<boolean>(() => {
    const token = safeStorageGet(STORAGE_KEYS.token);
    return Boolean(token && !isDemoToken(token));
  });
  const [recoveryEmail, setRecoveryEmail] = useState<string>('');

  // Verify existing JWT with GET /auth/me on mount or when entering Live Mode
  useEffect(() => {
    if (demoMode) {
      setUser(readDemoUser());
      setIsAuthenticated(safeStorageGet(STORAGE_KEYS.signedOut) !== 'true');
      setAuthChecking(false);
      return;
    }

    const token = safeStorageGet(STORAGE_KEYS.token);
    const baseUrl = settings.apiBaseUrl.trim() || getApiBaseUrl();
    if (!token || isDemoToken(token) || !baseUrl) {
      if (isDemoToken(token)) {
        safeStorageRemove(STORAGE_KEYS.token);
      }
      setUser(BLANK_LIVE_USER);
      setIsAuthenticated(false);
      setAuthChecking(false);
      return;
    }

    let active = true;
    setAuthChecking(true);
    void api
      .getMe()
      .then((me) => {
        if (!active) return;
        setUser(me);
        setIsAuthenticated(true);
      })
      .catch(() => {
        if (!active) return;
        safeStorageRemove(STORAGE_KEYS.token);
        safeStorageRemove(STORAGE_KEYS.user);
        setUser(BLANK_LIVE_USER);
        setIsAuthenticated(false);
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });

    return () => {
      active = false;
    };
  }, [demoMode, settings.apiBaseUrl]);

  // Global 401 session expiry handler
  useEffect(() => {
    setOnUnauthorizedCallback(() => {
      setUser(BLANK_LIVE_USER);
      setIsAuthenticated(false);
      showToast('Session expired — please sign in again.', 'warning');
    });
    return () => {
      setOnUnauthorizedCallback(null);
    };
  }, [showToast]);

  const signIn = useCallback(
    async (email: string, password: string, remember = true) => {
      const res = await api.login(email, password, remember);
      setUser(res.user);
      setIsAuthenticated(true);
      safeStorageRemove(STORAGE_KEYS.signedOut);
    },
    []
  );

  const signUp = useCallback(
    async (payload: {
      fullName: string;
      email: string;
      password: string;
      role: UserPracticeRole;
    }) => {
      const res = await api.signup(payload);
      if (demoMode) {
        setUser(res.user);
        setIsAuthenticated(true);
        safeStorageRemove(STORAGE_KEYS.signedOut);
      } else {
        // Mandatory Sign Up -> Login in Live Mode
        setUser(BLANK_LIVE_USER);
        setIsAuthenticated(false);
      }
    },
    [demoMode]
  );

  const enterDemoSandbox = useCallback(() => {
    showToast(
      'Demo Sandbox is disabled in production builds. Please sign in with your account.',
      'warning'
    );
  }, [showToast]);

  const signInWithDemoProvider = useCallback(
    (_provider: 'Google' | 'Apple' | 'Studio SAML') => {
      showToast(
        'OAuth demo pass is disabled. Please sign in with your email and password.',
        'warning'
      );
    },
    [showToast]
  );

  const signOut = useCallback(() => {
    void api.logout();
    const nextSid = rotateSessionId();
    setSessionId(nextSid);
    setIsAuthenticated(false);
    setUser(demoMode ? INITIAL_USER : BLANK_LIVE_USER);
    safeStorageSet(STORAGE_KEYS.signedOut, 'true', 'local');
  }, [demoMode]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const cleaned = email.trim();
    setRecoveryEmail(cleaned);
    const res = await api.forgotPassword(cleaned);
    return res.devResetToken;
  }, []);

  const completePasswordReset = useCallback(
    async (newPassword: string, token?: string) => {
      if (demoMode) {
        setIsAuthenticated(true);
        safeStorageRemove(STORAGE_KEYS.signedOut);
        return;
      }
      if (!token || !token.trim()) {
        throw new Error('A valid password reset token is required.');
      }
      await api.resetPassword(token.trim(), newPassword);
    },
    [demoMode]
  );

  const updateProfile = useCallback(
    async (updates: Partial<UserProfile>) => {
      if (demoMode) {
        setUser((prev) => {
          const next = { ...prev, ...updates };
          safeWriteJson(STORAGE_KEYS.user, next);
          return next;
        });
        return;
      }
      const updated = await api.updateMe(updates);
      setUser(updated);
    },
    [demoMode]
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const res = await api.changePassword(currentPassword, newPassword);
      setUser(res.user);
    },
    []
  );

  const updateSettings = useCallback((updates: Partial<AtelierSettings>) => {
    setSettings((prev) => {
      const nextBaseUrl =
        updates.apiBaseUrl !== undefined ? updates.apiBaseUrl : prev.apiBaseUrl;
      const autoLive =
        updates.apiBaseUrl !== undefined &&
        updates.apiBaseUrl.trim() !== '' &&
        updates.demoMode === undefined
          ? false
          : undefined;
      const nextDemo =
        updates.demoMode !== undefined
          ? updates.demoMode
          : autoLive !== undefined
            ? autoLive
            : prev.demoMode;
      const next: AtelierSettings = {
        ...prev,
        ...updates,
        apiBaseUrl: nextBaseUrl,
        demoMode: nextDemo ?? getApiBaseUrl() === '',
      };
      saveStoredSettings(next);
      return next;
    });
  }, []);

  const setDemoMode = useCallback((enabled: boolean) => {
    if (!enabled) {
      const token = safeStorageGet(STORAGE_KEYS.token);
      if (isDemoToken(token)) {
        safeStorageRemove(STORAGE_KEYS.token);
        safeStorageRemove(STORAGE_KEYS.user);
      }
    }
    setSettings((prev) => {
      const next: AtelierSettings = { ...prev, demoMode: enabled };
      saveStoredSettings(next);
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        authChecking,
        demoMode,
        sessionId,
        recoveryEmail,
        settings,
        signIn,
        signUp,
        signInWithDemoProvider,
        enterDemoSandbox,
        signOut,
        requestPasswordReset,
        completePasswordReset,
        updateProfile,
        changePassword,
        updateSettings,
        setDemoMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
