/**
 * Online lobby modal.
 *
 * Two ordered slots (blue then red), live presence badges, local pen switching, a ready toggle
 * and host-only match start. Automatically closes when the room transitions to `starting` so the
 * parent screen can present the live match.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Crown, LogOut, Play, UserRound, Wifi, WifiOff } from 'lucide-react';
import { useOnlineAuth } from './OnlineAuthContext';
import { useOnlineSession } from './OnlineSessionContext';
import { usePeerPresence } from './useRealtimeValue';
import {
  PaperDivider,
  PaperModalShell,
  PaperSectionLabel,
  PaperSegmented,
  PaperToggle,
} from '../components/PaperUI';
import { PEN_ORDER, PEN_SPECS, STARTER_PEN, isPenTypeId } from '../utils/Constants';
import type { PenTypeId } from '../utils/Constants';
import { ARENA_SPECS } from '../utils/ArenaCatalog';
import type { OnlineTeam, RoomPlayer } from './types';

function initialsFor(name: string | null | undefined): string {
  const source = (name ?? '').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  const initials = `${first}${last}`.toUpperCase();
  return initials || source.slice(0, 2).toUpperCase();
}

const SlotAvatar: React.FC<{ url?: string | null; name?: string | null; className?: string }> = ({
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
        <span className="font-display text-xs font-extrabold text-[#57534E]">
          {initialsFor(name)}
        </span>
      )}
    </span>
  );
};

const TEAM_COLORS: Record<OnlineTeam, string> = {
  blue: '#4F6D8A',
  red: '#9E3B36',
};

export const OnlineLobbyModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const session = useOnlineSession();
  const { uid } = useOnlineAuth();
  const room = session.room;
  const localUid = uid ?? session.uid;

  const [copied, setCopied] = useState(false);

  const players = useMemo(() => (room ? Object.values(room.players) : []), [room]);
  const blue = players.find((player) => player.team === 'blue') ?? null;
  const red = players.find((player) => player.team === 'red') ?? null;
  const localSlot = players.find((player) => player.uid === localUid) ?? null;

  const presence = usePeerPresence(
    [blue?.uid, red?.uid].filter((value): value is string => Boolean(value))
  );

  // Auto-close the lobby the moment the match is ready to start.
  useEffect(() => {
    if (!isOpen) return;
    if (room && (room.status === 'starting' || room.matchId)) {
      onClose();
    }
  }, [isOpen, room, onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    const code = room?.code;
    if (!code) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        return;
      }
    } catch {
      // Fall through to the legacy fallback below.
    }
    try {
      if (typeof document === 'undefined') return;
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
    } catch {
      // Clipboard access is best-effort — never throw from a copy action.
    }
  }, [room]);

  if (!isOpen) return null;

  if (!room) {
    return (
      <PaperModalShell
        title="Online Lobby"
        subtitle={session.roomLoading ? 'Connecting…' : 'Room unavailable'}
        icon={<UserRound className="h-4 w-4" />}
        onClose={onClose}
        maxWidthClass="max-w-lg"
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
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <p className="text-sm font-bold text-[#292725]">
            {session.roomLoading ? 'Connecting to the room…' : 'This room is no longer available.'}
          </p>
          <p className="text-xs text-[#6E6A64]">
            {session.roomLoading
              ? 'Fetching the latest room state.'
              : 'The host may have closed it, or the invite code has expired.'}
          </p>
        </div>
      </PaperModalShell>
    );
  }

  const hostPlayer = players.find((player) => player.uid === room.hostUid) ?? null;
  const isHost = Boolean(localUid && room.hostUid === localUid);
  const bothFilled = Boolean(blue && red);
  const bothReady = Boolean(bothFilled && blue?.ready && red?.ready);
  const canStart =
    bothReady && (room.status === 'ready' || room.status === 'waiting') && !session.busy;

  const arenaSpec = ARENA_SPECS[room.settings.arenaId as keyof typeof ARENA_SPECS];

  const isConnected = (player: RoomPlayer) => presence[player.uid]?.connected ?? player.connected;

  const handleLeave = async () => {
    await session.leaveRoom();
    onClose();
  };

  const handlePenChange = (pen: PenTypeId) => {
    void session.changePen(pen);
  };

  const handleReadyToggle = () => {
    if (localSlot) void session.setReady(!localSlot.ready);
  };

  const handleStart = () => {
    void session.startMatch();
  };

  const renderSlot = (player: RoomPlayer | null, team: OnlineTeam) => {
    const isLocal = Boolean(player && player.uid === localUid);
    const connected = player ? isConnected(player) : false;
    const penSpec = player && isPenTypeId(player.penType) ? PEN_SPECS[player.penType] : null;

    return (
      <div
        className={`rounded-xl border-[1.5px] p-3.5 ${
          player
            ? 'border-[#45413C] bg-[#FFFDF8]'
            : 'border-dashed border-[#8D8579] bg-[#F7F3EA]'
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className="h-9 w-1.5 shrink-0 rounded-sm"
            style={{ backgroundColor: TEAM_COLORS[team] }}
            aria-hidden="true"
          />
          {player ? (
            <>
              <SlotAvatar url={player.avatarUrl} name={player.displayName} className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-[#292725]">
                    {player.displayName}
                  </span>
                  {player.uid === room.hostUid && (
                    <Crown className="h-3.5 w-3.5 shrink-0 text-[#85581A]" />
                  )}
                  {isLocal && (
                    <span className="shrink-0 rounded border border-[#45413C]/40 bg-[#EFEAE0] px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#57534E]">
                      You
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-[#6E6A64]">@{player.username}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                    connected
                      ? 'border-[#2E664B]/50 bg-[#E6F2EC] text-[#2E664B]'
                      : 'border-[#9C6C2B]/50 bg-[#FBF3E2] text-[#85581A]'
                  }`}
                >
                  {connected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                  <span>{connected ? 'Online' : 'Offline'}</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                    player.ready
                      ? 'border-[#2E664B]/50 bg-[#E6F2EC] text-[#2E664B]'
                      : 'border-[#8D8579]/50 bg-[#F7F3EA] text-[#6E6A64]'
                  }`}
                >
                  {player.ready ? <Check className="h-2.5 w-2.5" /> : null}
                  <span>{player.ready ? 'Ready' : 'Not ready'}</span>
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center gap-2 text-xs text-[#8D8579]">
              <UserRound className="h-4 w-4" />
              <span>Waiting for player…</span>
            </div>
          )}
        </div>

        {player && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#57534E]">
            <span>
              Pen:{' '}
              <strong className="text-[#292725]">{penSpec?.label ?? player.penType}</strong>
            </span>
            <span className="font-bold uppercase tracking-wider text-[#4F6D8A]">
              Team {team === 'blue' ? 'Blue' : 'Red'}
            </span>
          </div>
        )}

        {player && isLocal && (
          <div className="mt-2.5">
            <PaperSectionLabel className="mb-1.5">Change Pen</PaperSectionLabel>
            <PaperSegmented
              options={PEN_ORDER.map((pen) => ({ id: pen, label: PEN_SPECS[pen].label }))}
              value={isPenTypeId(player.penType) ? player.penType : STARTER_PEN}
              onChange={handlePenChange}
              columns={4}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <PaperModalShell
      title="Online Lobby"
      subtitle={`Room ${room.code} · 1v1`}
      icon={<UserRound className="h-4 w-4" />}
      onClose={onClose}
      maxWidthClass="max-w-lg"
      zIndexClass="z-50"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleLeave()}
            className="paper-btn flex min-h-[40px] items-center gap-1.5 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-4 text-xs font-bold text-[#9E3B36] hover:bg-[#F9EAE9] focus-visible:outline-2 focus-visible:outline-[#9E3B36]"
          >
            <LogOut className="h-4 w-4" />
            <span>Leave Room</span>
          </button>

          <div className="flex items-center gap-3">
            {localSlot && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#292725]">
                  Ready
                </span>
                <PaperToggle
                  checked={localSlot.ready}
                  onChange={handleReadyToggle}
                  label="Toggle ready"
                />
              </div>
            )}

            {isHost ? (
              <button
                type="button"
                onClick={handleStart}
                disabled={!canStart}
                className="paper-btn flex min-h-[40px] items-center gap-1.5 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.05em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-4 w-4" />
                <span>Start Match</span>
              </button>
            ) : (
              <span className="max-w-[180px] text-right text-[11px] font-semibold text-[#6E6A64]">
                Waiting for host to start…
              </span>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-4 sm:p-6">
        {/* Invite code */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-[1.5px] border-[#45413C] bg-[#F7F3EA] p-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6E6A64]">
              Invite Code
            </div>
            <div className="font-mono-num text-2xl font-extrabold tracking-[0.3em] text-[#292725]">
              {room.code}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="paper-btn flex min-h-[40px] items-center gap-1.5 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3.5 text-xs font-bold text-[#292725] hover:bg-[#EFEAE0] focus-visible:outline-2 focus-visible:outline-[#4F6D8A]"
          >
            {copied ? <Check className="h-4 w-4 text-[#2E664B]" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Copied' : 'Copy invite code'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#6E6A64]">
          <span>
            Host:{' '}
            <strong className="text-[#292725]">{hostPlayer?.displayName ?? 'Host'}</strong>
            {hostPlayer?.username ? ` · @${hostPlayer.username}` : ''}
          </span>
          <span className="capitalize">
            Arena: <strong className="text-[#292725]">{arenaSpec?.shortLabel ?? room.settings.arenaId}</strong>
          </span>
          <span>
            Turn timer:{' '}
            <strong className="font-mono-num text-[#292725]">
              {room.settings.turnTimerSeconds === 0 ? 'Unlimited' : `${room.settings.turnTimerSeconds}s`}
            </strong>
          </span>
        </div>

        {room.status === 'closed' && (
          <div className="flex items-center gap-2 rounded-lg border-[1.5px] border-[#9E3B36] bg-[#F9EAE9] px-3 py-2 text-xs font-semibold text-[#9E3B36]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>This room has been closed. Leave to return to the online menu.</span>
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

        <div>
          <PaperSectionLabel className="mb-2" right={bothReady ? 'Both players ready' : '1v1 Duel'}>
            Players
          </PaperSectionLabel>
          <div className="space-y-2.5">
            {renderSlot(blue, 'blue')}
            {renderSlot(red, 'red')}
          </div>
        </div>

        <PaperDivider />

        <p className="text-[11px] leading-relaxed text-[#6E6A64]">
          Both players must be present and ready before the host can start. Your pen changes are
          saved to the room instantly; the opponent's pen is locked to their own choice.
        </p>
      </div>
    </PaperModalShell>
  );
};
