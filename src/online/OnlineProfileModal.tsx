/**
 * Online profile modal.
 *
 * Single surface for the whole Firebase auth lifecycle:
 *   unconfigured → loading → signedOut → needsProfile → ready
 * plus the abandoned-session notice. Uses `useOnlineAuth()` for every action so the UI never
 * talks to Firebase directly.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, LogIn, LogOut, UserRound } from 'lucide-react';
import { firebaseSetupHint, useOnlineAuth } from './OnlineAuthContext';
import {
  PaperDivider,
  PaperModalShell,
  PaperSectionLabel,
  PaperSegmented,
} from '../components/PaperUI';
import type { OnlineGender } from './types';

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,16}$/;
type UsernameAvailability = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';

const GENDER_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const GENDER_LABELS: Record<OnlineGender, string> = {
  male: 'Male',
  female: 'Female',
  prefer_not_to_say: 'Prefer not to say',
};

const INPUT_CLASS =
  'w-full rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3 py-2 text-sm text-[#292725] outline-none transition-colors placeholder:text-[#8D8579] focus:border-[#4F6D8A] focus:ring-2 focus:ring-[#4F6D8A]/25';

function initialsFor(name: string | null | undefined): string {
  const source = (name ?? '').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  const initials = `${first}${last}`.toUpperCase();
  return initials || source.slice(0, 2).toUpperCase();
}

const ProfileAvatar: React.FC<{ url?: string | null; name?: string | null; className?: string }> = ({
  url,
  name,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(url) && !failed;
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#45413C] bg-[#EFEAE0] ${className}`}
    >
      {showImage ? (
        <img
          src={url ?? ''}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="font-display text-sm font-extrabold text-[#57534E]">
          {initialsFor(name)}
        </span>
      )}
    </span>
  );
};

const ErrorBanner: React.FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => (
  <div
    role="alert"
    className="flex items-start gap-2 rounded-lg border-[1.5px] border-[#9E3B36] bg-[#F9EAE9] px-3 py-2 text-xs text-[#9E3B36]"
  >
    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <span className="min-w-0 flex-1 font-medium">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      className="shrink-0 rounded border border-[#9E3B36]/40 px-1.5 py-0.5 text-[10px] font-bold uppercase hover:bg-[#F3D9D8] focus-visible:outline-2 focus-visible:outline-[#9E3B36]"
    >
      Dismiss
    </button>
  </div>
);

const SessionExpiredNotice: React.FC = () => (
  <div className="flex items-start gap-2 rounded-lg border-[1.5px] border-[#9C6C2B] bg-[#FBF3E2] px-3 py-2 text-xs font-semibold text-[#85581A]">
    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <span>Your previous session expired. Please sign in again to continue.</span>
  </div>
);

export const OnlineProfileModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const {
    status,
    user,
    profile,
    error,
    abandonedSession,
    signInWithGoogle,
    signOutUser,
    saveProfile,
    checkUsername,
    clearError,
  } = useOnlineAuth();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState<OnlineGender | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [usernameAvailability, setUsernameAvailability] = useState<UsernameAvailability>('idle');

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(profile?.displayName ?? user?.displayName ?? '');
    setUsername(profile?.username ?? '');
    setGender(profile?.gender ?? null);
    setFormError(null);
    setSubmitting(false);
    setSigningIn(false);
    setEditingProfile(false);
    setUsernameAvailability('idle');
  }, [isOpen, user, profile]);

  const usernameValid = USERNAME_PATTERN.test(username.trim());
  const showProfileForm = status === 'needsProfile' || (status === 'ready' && editingProfile);

  useEffect(() => {
    if (!isOpen || !showProfileForm) {
      setUsernameAvailability('idle');
      return;
    }

    const candidate = username.trim();
    if (!candidate) {
      setUsernameAvailability('idle');
      return;
    }
    if (!USERNAME_PATTERN.test(candidate)) {
      setUsernameAvailability('invalid');
      return;
    }

    let cancelled = false;
    setUsernameAvailability('checking');
    const timer = window.setTimeout(() => {
      void checkUsername(candidate)
        .then((available) => {
          if (!cancelled) setUsernameAvailability(available ? 'available' : 'taken');
        })
        .catch(() => {
          if (!cancelled) setUsernameAvailability('error');
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, showProfileForm, username, checkUsername]);

  if (!isOpen) return null;

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setFormError('Please enter a display name.');
      return;
    }
    if (!USERNAME_PATTERN.test(username.trim())) {
      setFormError('Username must be 3–16 characters using letters, numbers or underscore.');
      return;
    }
    if (usernameAvailability !== 'available') {
      setFormError(
        usernameAvailability === 'taken'
          ? 'This username is already taken. Please choose another.'
          : 'Wait for username availability to be confirmed before continuing.'
      );
      return;
    }
    if (!gender) {
      setFormError('Please select a gender.');
      return;
    }
    setSubmitting(true);
    try {
      await saveProfile({ displayName: trimmedName, username, gender });
      setEditingProfile(false);
    } catch (saveError) {
      setFormError(
        saveError instanceof Error ? saveError.message : 'Could not save your profile.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  let content: React.ReactNode;

  if (status === 'unconfigured') {
    content = (
      <div className="rounded-xl border-[1.5px] border-[#9C6C2B] bg-[#FBF3E2] p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-[#85581A]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Online play is not configured</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[#57534E]">{firebaseSetupHint()}</p>
      </div>
    );
  } else if (status === 'loading') {
    content = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#4F6D8A]" />
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6E6A64]">Connecting…</p>
      </div>
    );
  } else if (status === 'signedOut') {
    content = (
      <div className="space-y-3">
        {abandonedSession && <SessionExpiredNotice />}
        {error && <ErrorBanner message={error} onDismiss={clearError} />}
        <p className="text-xs leading-relaxed text-[#57534E]">
          Sign in with a Google account to play online, track your record and find opponents.
        </p>
        <button
          type="button"
          onClick={handleSignIn}
          disabled={signingIn}
          className="paper-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A] disabled:opacity-50"
        >
          {signingIn ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          <span>{signingIn ? 'Signing in…' : 'Sign in with Google'}</span>
        </button>
      </div>
    );
  } else if (showProfileForm) {
    content = (
      <form onSubmit={handleSubmit} className="space-y-4">
        {abandonedSession && <SessionExpiredNotice />}
        <p className="text-xs leading-relaxed text-[#57534E]">
          {status === 'needsProfile'
            ? 'Choose a display name, a unique username and your gender to finish your online profile.'
            : 'Update your public profile. Your new username is reserved before the old one is released.'}
        </p>

        <div>
          <PaperSectionLabel className="mb-1.5">Display Name</PaperSectionLabel>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={32}
            placeholder="e.g. Alex Chen"
            className={INPUT_CLASS}
            autoComplete="nickname"
          />
        </div>

        <div>
          <PaperSectionLabel className="mb-1.5">Username</PaperSectionLabel>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={16}
            placeholder="letters, numbers or underscore"
            className={`${INPUT_CLASS} font-mono-num`}
            autoComplete="off"
            spellCheck={false}
          />
          <p
            aria-live="polite"
            className={`mt-1 text-[11px] ${
              usernameAvailability === 'taken' ||
              usernameAvailability === 'invalid' ||
              usernameAvailability === 'error'
                ? 'font-semibold text-[#9E3B36]'
                : usernameAvailability === 'available'
                  ? 'font-semibold text-[#2E664B]'
                  : 'text-[#6E6A64]'
            }`}
          >
            {usernameAvailability === 'checking' && 'Checking...'}
            {usernameAvailability === 'available' && 'Username available'}
            {usernameAvailability === 'taken' &&
              'This username is already taken. Please choose another.'}
            {usernameAvailability === 'invalid' &&
              'Invalid username. Use 3–16 English letters, numbers or underscores.'}
            {usernameAvailability === 'error' &&
              'Could not check username availability. Try again.'}
            {usernameAvailability === 'idle' &&
              '3–16 characters: letters, numbers or underscore.'}
          </p>
        </div>

        <div>
          <PaperSectionLabel className="mb-1.5">Gender</PaperSectionLabel>
          <PaperSegmented
            options={GENDER_OPTIONS}
            value={gender ?? ''}
            onChange={(next) => setGender(next as OnlineGender)}
            columns={3}
          />
        </div>

        {(formError || error) && (
          <ErrorBanner
            message={formError ?? error ?? ''}
            onDismiss={() => {
              setFormError(null);
              if (error) clearError();
            }}
          />
        )}

        <button
          type="submit"
          disabled={
            submitting ||
            !displayName.trim() ||
            !usernameValid ||
            usernameAvailability !== 'available' ||
            !gender
          }
          className="paper-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A] disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          <span>
            {submitting ? 'Saving…' : status === 'needsProfile' ? 'Continue' : 'Save Changes'}
          </span>
        </button>
        {status === 'ready' && (
          <button
            type="button"
            onClick={() => {
              setEditingProfile(false);
              setFormError(null);
            }}
            className="w-full rounded-lg px-4 py-2 text-xs font-semibold text-[#6E6A64] hover:bg-[#EFEAE0]"
          >
            Cancel
          </button>
        )}
      </form>
    );
  } else {
    content = (
      <div className="space-y-4">
        {abandonedSession && <SessionExpiredNotice />}
        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        <div className="flex items-center gap-3.5 rounded-xl border-[1.5px] border-[#45413C] bg-[#F7F3EA] p-4">
          <ProfileAvatar
            url={profile?.avatarUrl}
            name={profile?.displayName ?? user?.displayName}
            className="h-14 w-14"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-display text-base font-extrabold text-[#292725]">
                {profile?.displayName ?? user?.displayName ?? 'Player'}
              </span>
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2E664B]" />
            </div>
            {profile?.username && (
              <div className="truncate text-xs font-semibold text-[#4F6D8A]">@{profile.username}</div>
            )}
            {profile?.gender && (
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#6E6A64]">
                {GENDER_LABELS[profile.gender]}
              </div>
            )}
          </div>
        </div>

        <PaperDivider />

        <button
          type="button"
          onClick={() => {
            setEditingProfile(true);
            setFormError(null);
          }}
          className="paper-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-5 text-xs font-bold text-[#292725] hover:bg-[#EFEAE0] focus-visible:outline-2 focus-visible:outline-[#4F6D8A]"
        >
          <UserRound className="h-4 w-4" />
          <span>Edit Profile</span>
        </button>

        <button
          type="button"
          onClick={handleSignOut}
          className="paper-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-5 text-xs font-bold text-[#9E3B36] hover:bg-[#F9EAE9] focus-visible:outline-2 focus-visible:outline-[#9E3B36]"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </button>
      </div>
    );
  }

  return (
    <PaperModalShell
      title="Online Profile"
      subtitle="Google sign-in, public identity & online record"
      icon={<UserRound className="h-4 w-4" />}
      onClose={onClose}
      maxWidthClass="max-w-md"
      zIndexClass="z-50"
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="paper-btn min-h-[40px] rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A]"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-4 sm:p-6">{content}</div>
    </PaperModalShell>
  );
};
