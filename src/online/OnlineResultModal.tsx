/**
 * Online match result modal.
 *
 * Mirrors the offline MultiplayerResultModal styling, but derives the headline from the local
 * player's team versus the authoritative `winner` (or shows a draw / abandoned state).
 */

import React from 'react';
import { Home, Minus, ShieldCheck, Skull, Swords, Trophy } from 'lucide-react';
import type { MatchPlayerState, MatchRecord, OnlineTeam } from './types';

interface OnlineResultModalProps {
  match: MatchRecord;
  localUid: string | null;
  onReturnToLobby: () => void;
}

const TEAM_COLORS: Record<OnlineTeam, string> = {
  blue: '#4F6D8A',
  red: '#9E3B36',
};

type Outcome = 'victory' | 'defeat' | 'draw';

function resolveOutcome(match: MatchRecord, localTeam: OnlineTeam | null): Outcome {
  if (match.status === 'abandoned' || !match.winner) return 'draw';
  if (!localTeam) return 'draw';
  return match.winner === localTeam ? 'victory' : 'defeat';
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

const PlayerAvatar: React.FC<{ url?: string | null; name?: string | null; className?: string }> = ({
  url,
  name,
  className = '',
}) => {
  const [failed, setFailed] = React.useState(false);
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

export const OnlineResultModal: React.FC<OnlineResultModalProps> = ({
  match,
  localUid,
  onReturnToLobby,
}) => {
  const players = Object.values(match.players);
  const blue = players.find((player) => player.team === 'blue') ?? null;
  const red = players.find((player) => player.team === 'red') ?? null;

  const localPenId = localUid ? match.uidToPenId[localUid] ?? null : null;
  const localPlayer = localPenId ? match.players[localPenId] ?? null : null;
  const localTeam = localPlayer?.team ?? null;

  const outcome = resolveOutcome(match, localTeam);

  const headline =
    outcome === 'victory' ? 'Victory' : outcome === 'defeat' ? 'Defeat' : 'Match Abandoned';

  const headlineColor =
    outcome === 'victory' ? '#2E664B' : outcome === 'defeat' ? '#9E3B36' : '#57534E';
  const headerBg =
    outcome === 'victory' ? 'bg-[#E6F2EC]' : outcome === 'defeat' ? 'bg-[#F9EAE9]' : 'bg-[#F7F3EA]';

  const subline =
    outcome === 'victory'
      ? match.winReason || 'You knocked the rival pen off the desk.'
      : outcome === 'defeat'
        ? match.winReason || 'Your pen was knocked off the desk.'
        : match.status === 'abandoned'
          ? 'The match ended before a winner could be decided.'
          : 'No winner was recorded.';

  const renderRow = (player: MatchPlayerState | null, team: OnlineTeam) => {
    const isLocal = Boolean(player && localPlayer && player.penId === localPlayer.penId);
    return (
      <div
        key={team}
        className={`flex items-center gap-3 rounded-lg border-[1.5px] px-3 py-2.5 ${
          player ? 'border-[#45413C] bg-[#FFFDF8]' : 'border-dashed border-[#8D8579] bg-[#F7F3EA]'
        }`}
      >
        <span
          className="h-8 w-1.5 shrink-0 rounded-sm"
          style={{ backgroundColor: TEAM_COLORS[team] }}
          aria-hidden="true"
        />
        {player ? (
          <>
            <PlayerAvatar url={player.avatarUrl} name={player.displayName} className="h-9 w-9" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold text-[#292725]">{player.displayName}</span>
                {isLocal && (
                  <span className="shrink-0 rounded border border-[#45413C]/40 bg-[#EFEAE0] px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#57534E]">
                    You
                  </span>
                )}
              </div>
              <div className="truncate text-[11px] text-[#6E6A64]">
                @{player.username} · Team {team === 'blue' ? 'Blue' : 'Red'}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="font-mono-num text-xs font-bold text-[#85581A]">
                {player.knockoutsCount} KO
              </span>
              {player.eliminated ? (
                <span className="inline-flex items-center gap-1 rounded border border-[#9E3B36]/50 bg-[#F9EAE9] px-1.5 py-0.5 text-[10px] font-bold text-[#9E3B36]">
                  <Skull className="h-2.5 w-2.5" />
                  <span>Out</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded border border-[#2E664B]/50 bg-[#E6F2EC] px-1.5 py-0.5 text-[10px] font-bold text-[#2E664B]">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  <span>Standing</span>
                </span>
              )}
            </div>
          </>
        ) : (
          <span className="flex-1 text-xs text-[#8D8579]">No player</span>
        )}
      </div>
    );
  };

  return (
    <div
      className="safe-pad-x safe-pad-top safe-pad-bottom fixed inset-0 z-40 flex items-center justify-center bg-[#292725]/45 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
    >
      <div className="animate-modal-in paper-shadow-lg flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border-[1.5px] border-[#45413C] bg-[#FFFDF8] text-center text-[#292725]">
        {/* Header stamp */}
        <div className={`border-b border-[#D9C5A8] px-6 py-5 ${headerBg}`}>
          <div className="paper-shadow-sm mx-auto mb-2.5 flex h-13 w-13 items-center justify-center rounded-xl border-[1.5px] border-[#45413C] bg-[#FFFDF8]">
            {outcome === 'victory' ? (
              <Trophy className="h-7 w-7 text-[#2E664B]" />
            ) : outcome === 'defeat' ? (
              <Skull className="h-7 w-7 text-[#9E3B36]" />
            ) : (
              <Minus className="h-7 w-7 text-[#57534E]" />
            )}
          </div>

          <h2
            className="font-display text-2xl font-extrabold uppercase tracking-[0.04em] sm:text-3xl"
            style={{ color: headlineColor }}
          >
            {headline}
          </h2>
          <p className="mt-1 text-xs font-medium text-[#57534E] sm:text-sm">{subline}</p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            <span className="rounded-lg border border-[#365B82] bg-[#FFFDF8] px-3 py-1 font-mono-num text-xs font-bold text-[#365B82]">
              Blue: {match.scores.blueScore} · {match.scores.blueKnockouts} KO
            </span>
            <span className="text-xs font-bold uppercase text-[#6E6A64]">vs</span>
            <span className="rounded-lg border border-[#9E3B36] bg-[#FFFDF8] px-3 py-1 font-mono-num text-xs font-bold text-[#9E3B36]">
              Red: {match.scores.redScore} · {match.scores.redKnockouts} KO
            </span>
          </div>
        </div>

        {/* Players */}
        <div className="modal-scroll-area space-y-3 overflow-y-auto p-4 sm:p-5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-[#6E6A64]">
            <span className="flex items-center gap-1.5">
              <Swords className="h-3.5 w-3.5 text-[#4F6D8A]" />
              <span>Match Summary</span>
            </span>
            <span className="font-mono-num">
              {match.mode} · {match.turnNumber} {match.turnNumber === 1 ? 'Turn' : 'Turns'}
            </span>
          </div>

          <div className="space-y-2.5">
            {renderRow(blue, 'blue')}
            {renderRow(red, 'red')}
          </div>

          {match.winReason && (
            <div className="rounded-lg border border-[#D9C5A8] bg-[#F7F3EA] px-3 py-2 text-left text-[11px] text-[#57534E]">
              <span className="font-bold uppercase tracking-wider text-[#6E6A64]">Result </span>
              {match.winReason}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-[#D9C5A8] bg-[#F7F3EA] px-4 py-3.5 sm:px-5">
          <button
            type="button"
            onClick={onReturnToLobby}
            className="paper-btn flex min-h-[44px] items-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A]"
          >
            <Home className="h-4 w-4" />
            <span>Return to Lobby</span>
          </button>
        </div>
      </div>
    </div>
  );
};
