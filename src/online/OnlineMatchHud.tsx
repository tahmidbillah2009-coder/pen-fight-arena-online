/**
 * Online match HUD.
 *
 * A pointer-events-none overlay layered over the live arena view. It mirrors the offline
 * GameHUD visual language while surfacing online-only state: per-player connection badges, the
 * turn owner resolved from `uidToPenId`, and a client-side match clock derived from `startedAt`.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, LogOut, Swords, Wifi, WifiOff } from 'lucide-react';
import type { MatchPlayerState, MatchRecord, OnlineTeam } from './types';

interface OnlineMatchHudProps {
  match: MatchRecord;
  localUid: string | null;
  onQuit: () => void;
}

const TEAM_COLORS: Record<OnlineTeam, string> = {
  blue: '#4F6D8A',
  red: '#9E3B36',
};

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function statusLabel(match: MatchRecord): string {
  switch (match.status) {
    case 'countdown':
      return 'Get Ready';
    case 'active':
      return 'In Progress';
    case 'finished':
      return 'Finished';
    case 'abandoned':
      return 'Abandoned';
    default:
      return '';
  }
}

const PlayerPanel: React.FC<{
  player: MatchPlayerState;
  team: OnlineTeam;
  active: boolean;
  isLocal: boolean;
  align: 'left' | 'right';
}> = ({ player, team, active, isLocal, align }) => {
  const connected = player.connected !== false;
  return (
    <div
      className={`pointer-events-auto paper-shadow-sm flex items-center gap-2 rounded-lg border-[1.5px] px-2.5 py-1.5 transition-colors sm:gap-3 sm:px-3.5 sm:py-2 ${
        active
          ? team === 'blue'
            ? 'border-[#365B82] bg-[#E8EFF6]'
            : 'border-[#9E3B36] bg-[#F9EAE9]'
          : 'border-[#45413C] bg-[#FFFDF8]'
      } ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      <span
        className="h-5 w-1.5 shrink-0 rounded-sm sm:h-7 sm:w-2"
        style={{ backgroundColor: TEAM_COLORS[team] }}
        aria-hidden="true"
      />
      <div className="min-w-0 leading-tight">
        <div className={`flex items-center gap-1.5 text-xs font-bold sm:text-sm ${align === 'right' ? 'justify-end' : ''}`}>
          <span className="max-w-[110px] truncate">{player.displayName}</span>
          {isLocal && (
            <span className="shrink-0 rounded border border-[#45413C]/40 bg-[#EFEAE0] px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#57534E]">
              You
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider sm:text-[10px] ${align === 'right' ? 'justify-end' : ''}`}>
          <span className="truncate text-[#6E6A64]">@{player.username}</span>
          <span className="text-[#8D8579]" aria-hidden="true">
            ·
          </span>
          <span className="font-mono-num text-[#85581A]">{player.knockoutsCount} KO</span>
        </div>
      </div>
      <span
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          connected
            ? 'border-[#2E664B]/50 bg-[#E6F2EC] text-[#2E664B]'
            : 'border-[#9E3B36]/50 bg-[#F9EAE9] text-[#9E3B36]'
        }`}
        title={connected ? 'Connected' : 'Disconnected'}
      >
        {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      </span>
    </div>
  );
};

export const OnlineMatchHud: React.FC<OnlineMatchHudProps> = ({ match, localUid, onQuit }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const players = Object.values(match.players);
  const blue = players.find((player) => player.team === 'blue') ?? null;
  const red = players.find((player) => player.team === 'red') ?? null;

  const localPenId = localUid ? match.uidToPenId[localUid] ?? null : null;
  const localPlayer = localPenId ? match.players[localPenId] ?? null : null;
  const localTeam = localPlayer?.team ?? null;

  const isMyTurn = Boolean(localPenId && match.activePlayerId === localPenId);
  const opponent = localTeam ? (localTeam === 'blue' ? red : blue) : null;
  const opponentDisconnected = Boolean(opponent && opponent.connected === false);

  const startedAt = match.startedAt || match.createdAt;
  const endAt = match.finishedAt ?? now;
  const elapsedMs = startedAt > 0 ? Math.max(0, endAt - startedAt) : 0;

  const turnText = isMyTurn ? 'YOUR TURN' : "OPPONENT'S TURN";
  const hasLocalSlot = Boolean(localPenId);

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      {/* Top bar: player panels + centre status */}
      <header className="safe-pad-top safe-pad-x absolute inset-x-0 top-0 w-full p-2 sm:p-4">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {blue ? (
              <PlayerPanel
                player={blue}
                team="blue"
                active={match.activePlayerId === blue.penId}
                isLocal={Boolean(localPlayer && localPlayer.penId === blue.penId)}
                align="left"
              />
            ) : (
              <div className="pointer-events-auto paper-shadow-sm inline-flex rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3 py-2 text-xs text-[#6E6A64]">
                Waiting for player…
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {red ? (
              <div className="flex justify-end">
                <PlayerPanel
                  player={red}
                  team="red"
                  active={match.activePlayerId === red.penId}
                  isLocal={Boolean(localPlayer && localPlayer.penId === red.penId)}
                  align="right"
                />
              </div>
            ) : (
              <div className="flex justify-end">
                <div className="pointer-events-auto paper-shadow-sm inline-flex rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3 py-2 text-xs text-[#6E6A64]">
                  Waiting for player…
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Centre status stack */}
        <div className="pointer-events-none mt-2 flex w-full flex-col items-center gap-1.5">
          <div className="pointer-events-auto paper-shadow-sm flex items-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3 py-1">
            <span className="font-mono-num text-sm font-extrabold text-[#365B82]">
              {match.scores.blueScore}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6E6A64]">vs</span>
            <span className="font-mono-num text-sm font-extrabold text-[#9E3B36]">
              {match.scores.redScore}
            </span>
            <span className="text-[#D9C5A8]" aria-hidden="true">
              |
            </span>
            <span className="font-mono-num text-[10px] font-bold text-[#6E6A64]">
              KO {match.scores.blueKnockouts}-{match.scores.redKnockouts}
            </span>
          </div>

          <div
            className={`pointer-events-auto paper-shadow-sm flex items-center gap-2 rounded-lg border-[1.5px] px-3 py-1 text-[11px] font-bold uppercase tracking-wider sm:text-xs ${
              isMyTurn && match.status === 'active'
                ? 'border-[#2E664B] bg-[#E6F2EC] text-[#2E664B]'
                : 'border-[#45413C] bg-[#FFFDF8] text-[#292725]'
            }`}
          >
            {match.status === 'active' ? (
              <>
                <Swords className="h-3.5 w-3.5" />
                <span>{hasLocalSlot ? turnText : 'Watching'}</span>
              </>
            ) : (
              <span>{statusLabel(match)}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <div className="paper-shadow-sm flex items-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-2.5 py-0.5 text-[10px] font-semibold text-[#292725] sm:text-[11px]">
              <span className="text-[#6E6A64]">Match Time</span>
              <span className="font-mono-num font-bold text-[#4F6D8A]">{formatClock(elapsedMs)}</span>
              <span className="text-[#D9C5A8]" aria-hidden="true">
                |
              </span>
              <span className="text-[#6E6A64]">Turn</span>
              <span className="font-mono-num font-bold text-[#292725]">{match.turnNumber}</span>
            </div>
          </div>

          {opponentDisconnected && (
            <div className="pointer-events-auto paper-shadow-sm flex items-center gap-1.5 rounded-lg border-[1.5px] border-[#9E3B36] bg-[#F9EAE9] px-3 py-1 text-[11px] font-bold text-[#9E3B36]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Opponent disconnected — waiting for reconnect…</span>
            </div>
          )}
        </div>
      </header>

      {/* Bottom-right leave control */}
      <div className="pointer-events-none safe-pad-bottom absolute bottom-3 right-3 z-20 sm:bottom-4 sm:right-4">
        <button
          type="button"
          onClick={onQuit}
          className="paper-btn pointer-events-auto flex min-h-[40px] items-center gap-1.5 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3.5 text-xs font-bold text-[#9E3B36] hover:bg-[#F9EAE9] focus-visible:outline-2 focus-visible:outline-[#9E3B36]"
        >
          <LogOut className="h-4 w-4" />
          <span>Leave Match</span>
        </button>
      </div>

      {/* Finished / abandoned status banner */}
      {(match.status === 'finished' || match.status === 'abandoned') && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="paper-shadow-lg pointer-events-auto rounded-xl border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-6 py-3 text-center">
            <div className="font-display text-lg font-extrabold uppercase tracking-[0.05em] text-[#292725]">
              {statusLabel(match)}
            </div>
            {match.winReason && (
              <div className="mt-0.5 text-[11px] text-[#6E6A64]">{match.winReason}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
