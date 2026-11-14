/**
 * Online match history modal.
 *
 * Fetches the server-authoritative history once per open and renders an aggregate stats card
 * plus a scrollable ledger of recent results.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Flame, History, Loader2, Target, Trophy } from 'lucide-react';
import { useOnlineAuth } from './OnlineAuthContext';
import { listHistory } from './onlineService';
import { ApiError } from './onlineApi';
import { PaperDivider, PaperModalShell, PaperSectionLabel } from '../components/PaperUI';
import type { MatchHistoryEntry, PlayerStats } from './types';

interface OnlineHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface HistoryData {
  matches: MatchHistoryEntry[];
  stats: PlayerStats;
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

const StatCard: React.FC<{ label: string; value: React.ReactNode; tone?: 'blue' | 'red' | 'gold' | 'neutral' }> = ({
  label,
  value,
  tone = 'neutral',
}) => {
  const toneClass =
    tone === 'blue'
      ? 'border-[#365B82]/50 bg-[#E8EFF6] text-[#365B82]'
      : tone === 'red'
        ? 'border-[#9E3B36]/50 bg-[#F9EAE9] text-[#9E3B36]'
        : tone === 'gold'
          ? 'border-[#9C6C2B]/50 bg-[#FBF3E2] text-[#85581A]'
          : 'border-[#45413C] bg-[#FFFDF8] text-[#292725]';
  return (
    <div className={`paper-shadow-sm rounded-lg border-[1.5px] p-3 text-center ${toneClass}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">{label}</div>
      <div className="font-mono-num mt-1 text-xl font-bold">{value}</div>
    </div>
  );
};

export const OnlineHistoryModal: React.FC<OnlineHistoryModalProps> = ({ isOpen, onClose }) => {
  const { getIdToken } = useOnlineAuth();
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      const token = await getIdToken();
      if (cancelled) return;
      if (!token) {
        setError('You must be signed in to view your match history.');
        setLoading(false);
        return;
      }
      try {
        const result = await listHistory(token);
        if (cancelled) return;
        setData(result);
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof ApiError
            ? loadError.message
            : 'Could not load your match history.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, getIdToken]);

  if (!isOpen) return null;

  const stats = data?.stats ?? null;
  const matches = data?.matches ?? [];

  return (
    <PaperModalShell
      title="Online Match History"
      subtitle="Recent results and lifetime online stats"
      icon={<History className="h-4 w-4" />}
      onClose={onClose}
      maxWidthClass="max-w-xl"
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
      <div className="space-y-5 p-4 sm:p-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#4F6D8A]" />
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6E6A64]">
              Loading history…
            </p>
          </div>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border-[1.5px] border-[#9E3B36] bg-[#F9EAE9] px-3 py-2 text-xs text-[#9E3B36]"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 font-medium">{error}</span>
          </div>
        )}

        {!loading && !error && stats && (
          <>
            <div>
              <PaperSectionLabel className="mb-2" right="Online Career">
                Stats Summary
              </PaperSectionLabel>
              <div className="grid grid-cols-3 gap-2.5">
                <StatCard label="Wins" value={stats.onlineWins} tone="blue" />
                <StatCard label="Losses" value={stats.onlineLosses} tone="red" />
                <StatCard label="Matches" value={stats.onlineMatches} />
                <StatCard label="Knockouts" value={stats.knockouts} tone="gold" />
                <StatCard label="Streak" value={stats.currentStreak} />
                <StatCard label="Best Streak" value={stats.bestStreak} />
              </div>
            </div>

            <PaperDivider />

            <div>
              <PaperSectionLabel
                className="mb-2"
                right={`${matches.length} ${matches.length === 1 ? 'Result' : 'Results'}`}
              >
                Recent Matches
              </PaperSectionLabel>

              {matches.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#8D8579] bg-[#F7F3EA] px-4 py-10 text-center">
                  <Target className="h-6 w-6 text-[#8D8579]" />
                  <p className="text-sm font-bold text-[#292725]">No online matches yet</p>
                  <p className="text-xs text-[#6E6A64]">
                    Play a match online and your results will appear here.
                  </p>
                </div>
              ) : (
                <div className="modal-scroll-area max-h-[46vh] space-y-2.5 overflow-y-auto pr-1">
                  {matches.map((entry, index) => {
                    const won = entry.result === 'win';
                    return (
                      <div
                        key={`${entry.matchId}-${index}`}
                        className={`flex items-center gap-3 rounded-xl border-[1.5px] p-3 ${
                          won ? 'border-[#2E664B]/50 bg-[#E6F2EC]/45' : 'border-[#9E3B36]/50 bg-[#F9EAE9]/45'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-11 shrink-0 items-center justify-center rounded-lg border-[1.5px] text-[10px] font-extrabold uppercase tracking-wider ${
                            won
                              ? 'border-[#2E664B] bg-[#FFFDF8] text-[#2E664B]'
                              : 'border-[#9E3B36] bg-[#FFFDF8] text-[#9E3B36]'
                          }`}
                        >
                          {won ? (
                            <span className="flex items-center gap-1">
                              <Trophy className="h-3 w-3" />
                              Win
                            </span>
                          ) : (
                            <span>Loss</span>
                          )}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-[#292725]">
                            {entry.opponentName || 'Unknown opponent'}
                          </div>
                          <div className="truncate text-[11px] text-[#6E6A64]">
                            {entry.opponentUsername ? `@${entry.opponentUsername}` : entry.mode}
                            {entry.reason ? ` · ${entry.reason}` : ''}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="font-mono-num text-xs font-bold text-[#292725]">
                            {entry.blueScore}–{entry.redScore}
                          </span>
                          <span className="text-[10px] text-[#6E6A64]">
                            {formatDate(entry.completedAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {!loading && !error && !stats && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Flame className="h-6 w-6 text-[#8D8579]" />
            <p className="text-sm font-bold text-[#292725]">No history available</p>
            <p className="text-xs text-[#6E6A64]">Play an online match to start your record.</p>
          </div>
        )}
      </div>
    </PaperModalShell>
  );
};
