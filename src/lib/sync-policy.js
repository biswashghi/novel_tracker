export const MAX_FUTURE_CLOCK_MS = 5 * 60 * 1000;

export function clampMutationClock(original, now = Date.now()) {
  const clock = original.clock || {};
  const submittedWallMs = Number(clock.wallMs);
  const submittedLogical = Number(clock.logical);
  return {
    ...original,
    clock: {
      wallMs: Math.min(Number.isFinite(submittedWallMs) ? Math.max(0, submittedWallMs) : 0, now + MAX_FUTURE_CLOCK_MS),
      logical: Number.isFinite(submittedLogical) ? Math.max(0, Math.floor(submittedLogical)) : 0,
      actorId: String(original.deviceId || "")
    }
  };
}
