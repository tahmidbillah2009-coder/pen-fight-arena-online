/**
 * Online matchmaking modal.
 *
 * Owns its own search loop: joins the matchmaking queue, then polls every 1.5s until the server
 * reports `matched` (handing the match to the session) or `expired`. Every interval is cleared on
 * cancel, close and unmount.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, Swords, X } from 'lucide-react';
import { useOnlineAuth } from './OnlineAuthContext';
import { useOnlineSession } from './OnlineSessionContext';
import {
  cancelMatchmaking,
  joinMatchmaking,
  pollMatchmaking,
  type QueueSnapshot,
} from './onlineService';
import { ApiError } from './onlineApi';
import { PaperModalShell, PaperSectionLabel, PaperSegmented } from '../components/PaperUI';
import { PEN_ORDER, PEN_SPECS, isPenTypeId } from '../utils/Constants';
import type { PenTypeId } from '../utils/Constants';
import { ARENA_SPECS, isArenaId } from '../utils/ArenaCatalog';

interface OnlineMatchmakingModalProps {
  isOpen: boolean;
  onClose: () => void;
  penType?: string;
  arenaId?: string;
}

const POLL_INTERVAL_MS = 1500;

export const OnlineMatchmakingModal: React.FC<OnlineMatchmakingModalProps> = ({
  isOpen,
  onClose,
  penType,
  arenaId,
}) => {
  const { getIdToken } = useOnlineAuth();
  const { enterMatchById } = useOnlineSession();

  const resolvedArenaId = isArenaId(arenaId) ? arenaId : 'CLASSROOM_DESK';
  const arenaSpec = ARENA_SPECS[resolvedArenaId];

  const [selectedPen, setSelectedPen] = useState<PenTypeId>(
    isPenTypeId(penType) ? penType : 'GRIP_MASTER'
  );
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const pollRef = useRef<number | null>(null);
  const tokenRef = useRef<string | null>(null);
  const activeRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleMatched = useCallback(
    (matchId: string) => {
      activeRef.current = false;
      stopPolling();
      setSearching(false);
      enterMatchById(matchId);
      onClose();
    },
    [enterMatchById, onClose, stopPolling]
  );

  const pollOnce = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !activeRef.current) return;
    try {
      const snapshot = await pollMatchmaking(token);
      if (snapshot.status === 'matched' && snapshot.matchId) {
        handleMatched(snapshot.matchId);
        return;
      }
      if (snapshot.status === 'expired') {
        activeRef.current = false;
        stopPolling();
        setSearching(false);
        setError('Your matchmaking entry expired. Please search again.');
      }
    } catch (pollError) {
      activeRef.current = false;
      stopPolling();
      setSearching(false);
      setError(
        pollError instanceof ApiError
          ? pollError.message
          : 'Lost connection to matchmaking. Please try again.'
      );
    }
  }, [handleMatched, stopPolling]);

  const findMatch = useCallback(async () => {
    if (activeRef.current) return;
    setError(null);
    const token = await getIdToken();
    if (!token) {
      setError('You must be signed in to search for a match.');
      return;
    }
    tokenRef.current = token;

    let snapshot: QueueSnapshot;
    try {
      snapshot = await joinMatchmaking(token, { penType: selectedPen, arenaId: resolvedArenaId });
    } catch (joinError) {
      tokenRef.current = null;
      setError(
        joinError instanceof ApiError
          ? joinError.message
          : 'Could not reach matchmaking. Please try again.'
      );
      return;
    }

    if (snapshot.status === 'matched' && snapshot.matchId) {
      handleMatched(snapshot.matchId);
      return;
    }
    if (snapshot.status === 'expired') {
      tokenRef.current = null;
      setError('Your matchmaking entry expired. Please search again.');
      return;
    }

    activeRef.current = true;
    setSearching(true);
    stopPolling();
    pollRef.current = window.setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
  }, [getIdToken, handleMatched, pollOnce, resolvedArenaId, selectedPen, stopPolling]);

  const cancelSearch = useCallback(async () => {
    activeRef.current = false;
    stopPolling();
    setSearching(false);
    const token = tokenRef.current ?? (await getIdToken());
    tokenRef.current = null;
    if (!token) return;
    try {
      await cancelMatchmaking(token);
    } catch {
      // Cancelling is best-effort; the entry expires server-side regardless.
    }
  }, [getIdToken, stopPolling]);

  // Reset while open, and always cancel/clear when the modal closes or unmounts.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSearching(false);
    setElapsed(0);
    activeRef.current = false;
    return () => {
      const wasActive = activeRef.current;
      activeRef.current = false;
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      const token = tokenRef.current;
      tokenRef.current = null;
      if (wasActive && token) {
        void cancelMatchmaking(token).catch(() => undefined);
      }
    };
  }, [isOpen]);

  // Search elapsed timer.
  useEffect(() => {
    if (!searching) {
      setElapsed(0);
      return;
    }
    const tick = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, [searching]);

  if (!isOpen) return null;

  const handleClose = () => {
    void cancelSearch();
    onClose();
  };

  const clock = `${Math.floor(elapsed / 60)
    .toString()
    .padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;

  return (
    <PaperModalShell
      title="Matchmaking"
      subtitle={`Quick match · ${arenaSpec?.shortLabel ?? 'Classroom Desk'}`}
      icon={<Search className="h-4 w-4" />}
      onClose={handleClose}
      maxWidthClass="max-w-md"
      zIndexClass="z-50"
      closeDisabled={false}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="paper-btn flex min-h-[40px] items-center gap-1.5 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-4 text-xs font-bold text-[#292725] hover:bg-[#EFEAE0] focus-visible:outline-2 focus-visible:outline-[#4F6D8A]"
          >
            <X className="h-4 w-4" />
            <span>Close</span>
          </button>

          {searching ? (
            <button
              type="button"
              onClick={() => void cancelSearch()}
              className="paper-btn flex min-h-[40px] items-center gap-1.5 rounded-lg border-[1.5px] border-[#45413C] bg-[#9E3B36] px-5 text-xs font-bold uppercase tracking-[0.05em] text-[#FFFDF8] hover:bg-[#893430] focus-visible:outline-2 focus-visible:outline-[#9E3B36]"
            >
              <span>Cancel</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void findMatch()}
              className="paper-btn flex min-h-[40px] items-center gap-1.5 rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.05em] text-[#FFFDF8] hover:bg-[#435E79] focus-visible:outline-2 focus-visible:outline-[#4F6D8A]"
            >
              <Search className="h-4 w-4" />
              <span>Find Match</span>
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4 p-4 sm:p-6">
        {searching ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border-[1.5px] border-[#45413C] bg-[#E8EFF6] px-4 py-8 text-center">
            <span className="relative flex h-12 w-12 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#4F6D8A]/20" />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-[#45413C] bg-[#FFFDF8]">
                <Swords className="h-5 w-5 text-[#4F6D8A]" />
              </span>
            </span>
            <p className="font-display text-sm font-extrabold uppercase tracking-[0.05em] text-[#292725]">
              Searching for an opponent…
            </p>
            <p className="font-mono-num text-xs font-bold text-[#4F6D8A]">{clock}</p>
            <p className="max-w-xs text-[11px] text-[#6E6A64]">
              Pitting your {PEN_SPECS[selectedPen].label} against the next challenger.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-[#45413C] bg-[#F7F3EA] p-3 text-xs text-[#57534E]">
              <Search className="h-4 w-4 shrink-0 text-[#4F6D8A]" />
              <span>
                Pick a pen, then search. A match is created automatically the moment another
                player is queued.
              </span>
            </div>

            <div>
              <PaperSectionLabel className="mb-1.5">Your Pen</PaperSectionLabel>
              <PaperSegmented
                options={PEN_ORDER.map((pen) => ({ id: pen, label: PEN_SPECS[pen].label }))}
                value={selectedPen}
                onChange={setSelectedPen}
                columns={4}
              />
              <p className="mt-2 text-[11px] text-[#6E6A64]">
                <strong className="text-[#292725]">{PEN_SPECS[selectedPen].label}</strong> ·{' '}
                {PEN_SPECS[selectedPen].tagline}
              </p>
            </div>

            <div>
              <PaperSectionLabel className="mb-1.5">Arena</PaperSectionLabel>
              <div className="flex items-center gap-2 rounded-lg border-[1.5px] border-[#45413C] bg-[#FFFDF8] px-3 py-2">
                <span
                  className="h-4 w-4 shrink-0 rounded border border-[#45413C]"
                  style={{ backgroundColor: arenaSpec?.swatchHex ?? '#EFEAE0' }}
                />
                <span className="text-xs font-bold text-[#292725]">
                  {arenaSpec?.label ?? 'Classroom Wooden Desk'}
                </span>
              </div>
            </div>
          </>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border-[1.5px] border-[#9E3B36] bg-[#F9EAE9] px-3 py-2 text-xs text-[#9E3B36]"
          >
            <span className="min-w-0 flex-1 font-medium">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded border border-[#9E3B36]/40 px-1.5 py-0.5 text-[10px] font-bold uppercase hover:bg-[#F3D9D8] focus-visible:outline-2 focus-visible:outline-[#9E3B36]"
            >
              Dismiss
            </button>
          </div>
        )}

        {searching && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-[#6E6A64]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4F6D8A]" />
            <span>Checking the queue every 1.5 seconds…</span>
          </div>
        )}
      </div>
    </PaperModalShell>
  );
};
