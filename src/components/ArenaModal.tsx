import React, { useState } from 'react';
import { BookOpen, Check, Compass, FlaskConical, School } from 'lucide-react';
import { ARENA_ORDER, ARENA_SPECS, ArenaId, PHYSICS_BALANCE } from '../utils/Constants';
import { ARENA_PREVIEW_IMAGES } from '../utils/ArenaPreviews';
import { PaperDivider, PaperModalShell, PaperSectionLabel } from './PaperUI';

interface ArenaModalProps {
  isOpen: boolean;
  arenaId: ArenaId;
  isInMatch?: boolean;
  onSelectArena: (id: ArenaId) => void;
  onClose: () => void;
}

function getArenaIcon(id: ArenaId): React.ReactNode {
  switch (id) {
    case 'LIBRARY_DESK':
      return <BookOpen className="h-5 w-5" />;
    case 'SCIENCE_LAB':
      return <FlaskConical className="h-5 w-5" />;
    case 'CLASSROOM_DESK':
    default:
      return <School className="h-5 w-5" />;
  }
}

export const ArenaModal: React.FC<ArenaModalProps> = ({
  isOpen,
  arenaId,
  isInMatch = false,
  onSelectArena,
  onClose,
}) => {
  const [failedImages, setFailedImages] = useState<Partial<Record<ArenaId, boolean>>>({});

  if (!isOpen) return null;

  const activeSpec = ARENA_SPECS[arenaId];

  return (
    <PaperModalShell
      title="Arena Selection"
      subtitle="Select tabletop setting — standardized physics across all desks"
      icon={<Compass className="h-4 w-4" />}
      onClose={onClose}
      maxWidthClass="max-w-4xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-medium text-[#6E6A64]">
            Active arena: <strong className="text-[#292725]">{activeSpec.label}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="paper-btn min-h-[40px] rounded-lg border-[1.5px] border-[#45413C] bg-[#4F6D8A] px-5 text-xs font-bold uppercase tracking-[0.06em] text-[#FFFDF8] hover:bg-[#435E79]"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-5 p-4 sm:p-6">
        {isInMatch && (
          <div className="rounded-lg border border-[#85581A] bg-[#FBF4E4] px-3.5 py-2.5 text-xs font-medium text-[#5C3D12]">
            Arena switching is locked during an active match. Finish or exit to the menu to switch desks.
          </div>
        )}

        <div className="space-y-3">
          <PaperSectionLabel right={`${ARENA_ORDER.length} Arenas Available`}>
            Playable Tabletops
          </PaperSectionLabel>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {ARENA_ORDER.map((id) => {
              const spec = ARENA_SPECS[id];
              const isSelected = arenaId === id;
              const previewSrc = ARENA_PREVIEW_IMAGES[id];
              const imageFailed = Boolean(failedImages[id]);

              return (
                <article
                  key={id}
                  className={`flex flex-col overflow-hidden rounded-xl border-[1.5px] transition-all ${
                    isSelected
                      ? 'paper-shadow border-[#45413C] bg-[#FFFDF8] ring-2 ring-[#2E664B]/25'
                      : 'paper-shadow-sm border-[#C9B99F] bg-[#FFFDF8] hover:border-[#45413C]'
                  }`}
                >
                  {/* Unique Arena Preview Image with Zero-Broken-Image Fallback */}
                  <div className="relative aspect-[16/9] w-full overflow-hidden border-b border-[#D9C5A8] bg-[#EFEAE0]">
                    {!imageFailed ? (
                      <img
                        src={previewSrc}
                        alt={`${spec.label} tabletop arena preview`}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedImages((prev) => ({
                            ...prev,
                            [id]: true,
                          }))
                        }
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-4 text-center"
                        style={{ backgroundColor: spec.swatchHex }}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#45413C] bg-[#FFFDF8] text-[#292725]">
                          {getArenaIcon(id)}
                        </div>
                        <span className="rounded border border-[#45413C] bg-[#FFFDF8]/95 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#292725]">
                          {spec.shortLabel}
                        </span>
                      </div>
                    )}

                    {/* Selected State Indicator */}
                    {isSelected && (
                      <div className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded border border-[#2E664B] bg-[#E6F2EC] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#2E664B] shadow-sm">
                        <Check className="h-3 w-3" />
                        Selected
                      </div>
                    )}
                  </div>

                  {/* Card Body */}
                  <div className="flex flex-1 flex-col justify-between p-4">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-display text-base font-extrabold uppercase tracking-[0.03em] text-[#292725]">
                          {spec.label}
                        </h3>
                        <span
                          className="mt-1 h-3.5 w-3.5 shrink-0 rounded-sm border border-[#45413C]"
                          style={{ backgroundColor: spec.swatchHex }}
                          aria-hidden="true"
                        />
                      </div>

                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6E6A64]">
                        {spec.surfaceMaterial} · {spec.lightingMood}
                      </p>

                      <p className="mt-2 text-xs leading-relaxed text-[#57534E]">
                        {spec.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-1">
                      <button
                        type="button"
                        disabled={isInMatch || isSelected}
                        onClick={() => onSelectArena(id)}
                        className={`paper-btn flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] px-3 text-xs font-bold uppercase tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-[#4F6D8A] ${
                          isSelected
                            ? 'border-[#2E664B] bg-[#E6F2EC] text-[#2E664B] cursor-default'
                            : isInMatch
                              ? 'border-[#C9B99F] bg-[#EFEAE0] text-[#8D8579] cursor-not-allowed'
                              : 'border-[#45413C] bg-[#4F6D8A] text-[#FFFDF8] hover:bg-[#435E79]'
                        }`}
                      >
                        {isSelected ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>Selected</span>
                          </>
                        ) : (
                          <span>Select</span>
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <PaperDivider />

        {/* Standardized Tabletop Physics Strip */}
        <div className="space-y-2">
          <PaperSectionLabel right="Identical Across All Arenas">
            Standardized Match Physics
          </PaperSectionLabel>
          <div className="grid grid-cols-3 gap-2.5 text-center">
            <div className="rounded-lg border border-[#D9C5A8] bg-[#F7F3EA] px-2.5 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#6E6A64]">
                Dimensions
              </div>
              <div className="font-mono-num mt-0.5 text-xs font-bold text-[#292725]">
                {PHYSICS_BALANCE.arenaWidth} × {PHYSICS_BALANCE.arenaDepth} u
              </div>
            </div>
            <div className="rounded-lg border border-[#D9C5A8] bg-[#F7F3EA] px-2.5 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#6E6A64]">
                Surface Friction
              </div>
              <div className="font-mono-num mt-0.5 text-xs font-bold text-[#292725]">
                {PHYSICS_BALANCE.surfaceFriction.toFixed(2)} μ
              </div>
            </div>
            <div className="rounded-lg border border-[#D9C5A8] bg-[#F7F3EA] px-2.5 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#6E6A64]">
                Bounce
              </div>
              <div className="font-mono-num mt-0.5 text-xs font-bold text-[#292725]">
                {PHYSICS_BALANCE.tableRestitution.toFixed(2)} e
              </div>
            </div>
          </div>
        </div>
      </div>
    </PaperModalShell>
  );
};
