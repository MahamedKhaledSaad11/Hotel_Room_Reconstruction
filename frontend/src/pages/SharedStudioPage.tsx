import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SceneViewer } from '../components/studio/SceneViewer';
import { api } from '../services/api';
import type { SharedSceneData } from '../types';

export const SharedStudioPage: React.FC = () => {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [scene, setScene] = useState<SharedSceneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setScene(null);
    setError('');
    if (!shareToken) {
      setError('Missing share token.');
      setLoading(false);
      return;
    }
    void api
      .getSharedScene(shareToken)
      .then((data) => {
        if (active) setScene(data);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : 'This link is invalid, expired, or revoked.'
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shareToken, attempt]);
  return (
    <div className="h-dvh min-h-[520px] flex flex-col bg-surface text-on-surface px-4 sm:px-6 pb-4">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div>
          <h1 className="font-headline text-2xl">
            {scene?.projectName || 'Shared walkthrough'}
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            {scene?.shareLabel || 'Room reconstruction'} · Read-only
          </p>
        </div>
        <Link to="/spaces" className="text-xs text-primary font-semibold">
          AuraSpace
        </Link>
      </header>
      {loading ? (
        <div
          role="status"
          className="flex-1 grid place-items-center rounded-3xl border border-border-sand bg-white"
        >
          Opening shared scene…
        </div>
      ) : scene ? (
        <div className="flex-1 min-h-0">
          <SceneViewer scene={scene} />
        </div>
      ) : (
        <div
          role="alert"
          className="flex-1 flex flex-col justify-center items-center text-center rounded-3xl border border-border-sand bg-white p-8"
        >
          <span className="material-symbols-outlined text-4xl text-primary">
            link_off
          </span>
          <h2 className="font-headline text-2xl mt-4">
            Shared scene unavailable
          </h2>
          <p className="text-sm text-on-surface-variant mt-3 max-w-md">
            {error}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="rounded-full bg-primary text-white px-5 py-2 mt-5"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};
