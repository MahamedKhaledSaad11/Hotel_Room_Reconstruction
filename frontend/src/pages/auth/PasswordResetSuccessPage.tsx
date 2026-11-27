import React from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../../components/layout/AuthShell';

export const PasswordResetSuccessPage:React.FC=()=> <AuthShell>
  <main className="max-w-xl mx-auto w-full px-6 py-16 lg:py-24">
    <div className="rounded-3xl border border-border-sand bg-surface-container-lowest p-8 sm:p-12 text-center shadow-soft">
      <span className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary-container text-primary"><span className="material-symbols-outlined text-4xl">lock_reset</span></span>
      <h1 className="font-headline text-3xl sm:text-4xl mt-6">Password updated</h1>
      <p className="mt-4 text-sm text-on-surface-variant leading-relaxed">Sign in with your new password to return to your room reconstructions.</p>
      <Link to="/login" className="inline-flex items-center justify-center gap-2 mt-8 rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-white shadow-soft hover:bg-primary-hover">Sign in<span className="material-symbols-outlined text-[18px]">arrow_forward</span></Link>
    </div>
  </main>
</AuthShell>;
