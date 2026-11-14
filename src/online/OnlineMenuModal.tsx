/**
 * Online Multiplayer hub.
 *
 * Central entry point for the online experience: identity header, quick actions, inline room
 * creation / join panels and the sub-modals (matchmaking + lobby) it renders itself so the
 * parent screen only has to toggle a single modal.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Gamepad2,
  Hash,
  History,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  Search,
  UserRound,
  Users,
} from 'lucide-react';
import { useOnlineAuth } from './OnlineAuthContext';
import { useOnlineSession } from './OnlineSessionContext';
import { OnlineMatchmakingModal } from './OnlineMatchmakingModal';
import { OnlineLobbyModal } from './OnlineLobbyModal';
import { PaperDivider, PaperModalShell, PaperSectionLabel, PaperSegmented } from '../components/PaperUI';
import { PEN_ORDER, PEN_SPECS, STARTER_PEN } from '../utils/Constants';
import type { PenTypeId } from '../utils/Constants';
import { ARENA_ORDER, ARENA_SPECS, DEFAULT_ARENA } from '../utils/ArenaCatalog';
import type { ArenaId } from '../utils/ArenaCatalog';
import { TURN_TIMER_OPTIONS } from '../game/MultiplayerTypes';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './types';
import type { ArenaOrientation } from './types';

function detectOrientation(): ArenaOrientation {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'horizontal';
  }
  try {
    return window.matchMedia('(orientation: portrait)').matches ? 'vertical' : 'horizontal';
  } catch {
    return 'horizontal';
  }
}

function initialsFor(name: string | null | undefined): string {
  const source = (name ?? '').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  const initials = `${first}${last}`.toUpperCase();
  return initials || source.slice(0, 2).toUpperCase();
}

const HubAvatar: React.FC<{ url?: string | null; name?: string | null; className?: string }> = ({
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
        <img src={url ?? ''} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span className="font-display text-sm font-extrabold text-[#57534E]">{initialsFor(name)}</span>
      )}
    </span>
  );
};

const MenuButton: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  badge?: string;
}> = ({ icon, title, hint, onClick, disabled, primary, badge }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`paper-btn flex w-full items-center gap-3 rounded-xl border-[1.5px] p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#4F6D8A] disabled:cursor-not-allowed disabled:opacity-45 ${
      primary
        ? 'border-[#45413C] bg-[#4F6D8A] text-[#FFFDF8] hover:bg-[#435E79]'
        : 'border-[#45413C] bg-[#FFFDF8] text-[#292725] hover:bg-[#F7F3EA]'
    }`}
  >
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
        primary
          ? 'border-[#FFFDF8]/60 bg-[#FFFDF8]/15 text-[#FFFDF8]'
          : 'border-[#45413C] bg-[#EFEAE0] text-[#4F6D8A]'
      }`}
    >
      {icon}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="truncate text-sm font-bold">{title}</span>
        {badge && (
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
              primary
                ? 'border-[#FFFDF8]/50 text-[#FFFDF8]'
                : 'border-[#45413C]/40 bg-[#EFEAE0] text-[#57534E]'
            }`}
          >
            {badge}
          </span>
        )}
      </span>
      <span className={`block truncate text-[11px] ${primary ? 'text-[#FFFDF8]/80' : 'text-[#6E6A64]'}`}>
        {hint}
      </span>
    </span>
  </button>
);

export const OnlineMenuModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenHistory: () => void;
}> = ({ isOpen, onClose, onOpenProfile, onOpenHistory }) => {
  const auth = useOnlineAuth();
  const session = useOnlineSession();

  const [panel, setPanel] = useState<'none' | 'create' | 'join'>('none');
  const [matchmakingOpen, setMatchmakingOpen] = useState(false);
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'create' | 'join' | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [arenaId, setArenaId] = useState<ArenaId>(DEFAULT_ARENA);
  const [createPen, setCreatePen] = useState<PenTypeId>(STARTER_PEN);
  const [turnTimer, setTurnTimer] = useState<number>(15);

  const [joinCode, setJoinCode] = useState('');
  const [joinPen, setJoinPen] = useState<PenTypeId>(STARTER_PEN);

  const ready = auth.status === 'ready';
  const signedIn = auth.status === 'ready' || auth.status === 'needsProfile';
  const busy = session.busy || pendingAction !== null;

  useEffect(() => {
    if (!isOpen) return;
    setPanel('none');
    setMatchmakingOpen(false);
    setLobbyOpen(false);
    setPendingAction(null);
    setJoinCode('');
    setSigningIn(false);
  }, [isOpen]);

  // A successful create/join flips roomCode on the session — open the lobby then.
  useEffect(() => {
    if (pendingAction === null) return;
    if (session.roomCode) {
      setPendingAction(null);
      setPanel('none');
      setLobbyOpen(true);
      return;
    }
    if (!session.busy && session.error) {
      setPendingAction(null);
    }
  }, [pendingAction, session.roomCode, session.busy, session.error]);

  const closeAll = useCallback(() => {
    setMatchmakingOpen(false);
    setLobbyOpen(false);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await auth.signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  };

  const handleCreate = async () => {
    setPendingAction('create');
    await session.createRoom({
      arenaId,
      penType: createPen,
      turnTimerSeconds: turnTimer,
      orientation: detectOrientation(),
    });
  };

  const handleJoin = async () => {
    if (joinCode.length !== ROOM_CODE_LENGTH) return;
    setPendingAction('join');
    await session.joinRoom(joinCode, joinPen);
  };

  const handleCodeChange = (raw: string) => {
    const cleaned = raw
      .toUpperCase()
      .split('')
      .filter((ch) => ROOM_CODE_ALPHABET.includes(ch))
      .join('')
      .slice(0, ROOM_CODE_LENGTH);
    setJoinCode(cleaned);
  };

  const identityName = auth.profile?.displayName ?? auth.user?.displayName ?? null;
  const avatarUrl = auth.profile?.avatarUrl ?? auth.user?.photoURL ?? null;

  return (
    <>
      <PaperModalShell
        title="Online Multiplayer"
        subtitle="Sign in, create or join a room and duel opponents online"
        icon={<Users className="h-4 w-4" />}
        onClose={onClose}
        maxWidthClass="max-w-lg"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-[#6E6A64]">
              {busy ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#4F6D8A]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Working…
                </span>
              ) : ready && auth.profile ? (
                `Signed in as @${auth.profile.username}`
              ) : (
                'Sign in to unlock online play'
              )}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="paper-btn min-h-[40px] shrink-0 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A]"
            >
              Close
            </button>
          </div>
        }
      >
        <div className="space-y-4 p-4 sm:p-6">
          {/* Identity header */}
          {signedIn ? (
            <div className="flex items-center gap-3.5 rounded-xl border-[1.5px] border-[#45413C] bg-[#F7F3EA] p-3.5">
              <HubAvatar url={avatarUrl} name={identityName} className="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-sm font-extrabold text-[#292725]">
                  {identityName ?? 'Player'}
                </div>
                {auth.profile?.username ? (
                  <div className="truncate text-xs font-semibold text-[#4F6D8A]">
                    @{auth.profile.username}
                  </div>
                ) : (
                  <div className="text-xs text-[#6E6A64]">Finishing profile setup…</div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 rounded-xl border-[1.5px] border-[#45413C] bg-[#F7F3EA] p-3.5">
              <p className="text-xs leading-relaxed text-[#57534E]">
                Sign in with Google to play online, find opponents and track your record.
              </p>
              <button
                type="button"
                onClick={() => void handleSignIn()}
                disabled={signingIn}
                className="paper-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A] disabled:opacity-50"
              >
                {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                <span>{signingIn ? 'Signing in…' : 'Sign in with Google'}</span>
              </button>
            </div>
          )}

          {auth.status === 'needsProfile' && (
            <div className="flex items-start gap-2 rounded-lg border-[1.5px] border-[#9C6C2B] bg-[#FBF3E2] p-3 text-xs text-[#85581A]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">Finish your online profile</p>
                <p className="mt-0.5 text-[#85581A]/90">
                  Set a display name, username and gender before you can play online.
                </p>
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="paper-btn mt-2 min-h-[34px] rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3 text-[11px] font-bold uppercase tracking-wider text-[#85581A] hover:bg-[#FBF3E2] focus-visible:outline-2 focus-visible:outline-[#4F6D8A]"
                >
                  Set up profile
                </button>
              </div>
            </div>
          )}

          {session.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border-[1.5px] border-[#9E3B36] bg-[#F9EAE9] px-3 py-2 text-xs text-[#9E3B36]"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 font-medium">{session.error}</span>
              <button
                type="button"
                onClick={session.clearError}
                className="shrink-0 rounded border border-[#9E3B36]/40 px-1.5 py-0.5 text-[10px] font-bold uppercase hover:bg-[#F3D9D8] focus-visible:outline-2 focus-visible:outline-[#9E3B36]"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Quick actions */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <MenuButton
              icon={<Gamepad2 className="h-4 w-4" />}
              title="Play Online"
              hint="Jump straight into quick matchmaking"
              onClick={() => setMatchmakingOpen(true)}
              disabled={!ready || busy}
              primary
            />
            <MenuButton
              icon={<Search className="h-4 w-4" />}
              title="Matchmaking"
              hint="Find a random opponent"
              onClick={() => setMatchmakingOpen(true)}
              disabled={!ready || busy}
            />
            <MenuButton
              icon={<Plus className="h-4 w-4" />}
              title="Create Room"
              hint="Host a private 1v1 and share the code"
              onClick={() => setPanel(panel === 'create' ? 'none' : 'create')}
              disabled={!ready || busy}
            />
            <MenuButton
              icon={<Hash className="h-4 w-4" />}
              title="Join Room"
              hint="Enter a 6-character invite code"
              onClick={() => setPanel(panel === 'join' ? 'none' : 'join')}
              disabled={!ready || busy}
            />
            <MenuButton
              icon={<Users className="h-4 w-4" />}
              title="Friends / Invite"
              hint="Play with friends"
              disabled
              badge="Soon"
            />
            <MenuButton
              icon={<UserRound className="h-4 w-4" />}
              title="Online Profile"
              hint="View identity and sign-in status"
              onClick={onOpenProfile}
              disabled={!ready || busy}
            />
            <MenuButton
              icon={<History className="h-4 w-4" />}
              title="Match History"
              hint="Recent online results and stats"
              onClick={onOpenHistory}
              disabled={!ready || busy}
            />
            {signedIn && (
              <MenuButton
                icon={<LogOut className="h-4 w-4" />}
                title="Sign out"
                hint="Sign out of your Google account"
                onClick={() => void auth.signOutUser()}
                disabled={busy}
              />
            )}
          </div>

          {/* Create room panel */}
          {panel === 'create' && (
            <div className="space-y-4 rounded-xl border-[1.5px] border-[#45413C] bg-[#F7F3EA] p-4">
              <PaperSectionLabel>New Room</PaperSectionLabel>

              <div>
                <PaperSectionLabel className="mb-1.5">Arena</PaperSectionLabel>
                <PaperSegmented
                  options={ARENA_ORDER.map((id) => ({ id, label: ARENA_SPECS[id].shortLabel }))}
                  value={arenaId}
                  onChange={setArenaId}
                  columns={3}
                />
              </div>

              <div>
                <PaperSectionLabel className="mb-1.5">Your Pen</PaperSectionLabel>
                <PaperSegmented
                  options={PEN_ORDER.map((pen) => ({ id: pen, label: PEN_SPECS[pen].label }))}
                  value={createPen}
                  onChange={setCreatePen}
                  columns={4}
                />
              </div>

              <div>
                <PaperSectionLabel className="mb-1.5">Turn Timer</PaperSectionLabel>
                <PaperSegmented
                  options={TURN_TIMER_OPTIONS.map((opt) => ({
                    id: String(opt.value),
                    label: opt.label,
                  }))}
                  value={String(turnTimer)}
                  onChange={(next) => setTurnTimer(Number(next))}
                  columns={3}
                />
              </div>

              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={busy}
                className="paper-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A] disabled:opacity-50"
              >
                {pendingAction === 'create' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span>{pendingAction === 'create' ? 'Creating room…' : 'Create Room'}</span>
              </button>
            </div>
          )}

          {/* Join room panel */}
          {panel === 'join' && (
            <div className="space-y-4 rounded-xl border-[1.5px] border-[#45413C] bg-[#F7F3EA] p-4">
              <PaperSectionLabel>Join Room</PaperSectionLabel>

              <div>
                <PaperSectionLabel className="mb-1.5">Invite Code</PaperSectionLabel>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => handleCodeChange(event.target.value)}
                  placeholder="ABC123"
                  maxLength={ROOM_CODE_LENGTH}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono-num w-full rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3 py-2.5 text-center text-lg font-extrabold uppercase tracking-[0.35em] text-[#292725] outline-none transition-colors placeholder:text-[#8D8579] focus:border-[#4F6D8A] focus:ring-2 focus:ring-[#4F6D8A]/25"
                />
              </div>

              <div>
                <PaperSectionLabel className="mb-1.5">Your Pen</PaperSectionLabel>
                <PaperSegmented
                  options={PEN_ORDER.map((pen) => ({ id: pen, label: PEN_SPECS[pen].label }))}
                  value={joinPen}
                  onChange={setJoinPen}
                  columns={4}
                />
              </div>

              <button
                type="button"
                onClick={() => void handleJoin()}
                disabled={busy || joinCode.length !== ROOM_CODE_LENGTH}
                className="paper-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A] disabled:opacity-50"
              >
                {pendingAction === 'join' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Hash className="h-4 w-4" />
                )}
                <span>{pendingAction === 'join' ? 'Joining room…' : 'Join Room'}</span>
              </button>
            </div>
          )}

          <PaperDivider />

          <p className="text-[11px] leading-relaxed text-[#6E6A64]">
            Online play is authoritative — the server validates every shot. Keep the tab open; a
            dropped connection briefly pauses the match while your opponent waits.
          </p>
        </div>
      </PaperModalShell>

      <OnlineMatchmakingModal isOpen={matchmakingOpen} onClose={closeAll} />
      <OnlineLobbyModal isOpen={lobbyOpen} onClose={closeAll} />
    </>
  );
};
