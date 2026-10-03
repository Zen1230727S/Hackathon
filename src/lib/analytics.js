/**
 * Attendance analytics + the Attendance Recovery Planner ("what-if" simulator).
 *
 * Everything in this file is DETERMINISTIC ARITHMETIC over attendance records
 * that are already stored in the app. There is no AI model, no external API and
 * no hidden data source here.
 *
 * Notation used below:
 *   attended = classes the student actually attended (present or late)
 *   total    = classes held for the student's class so far
 *   T        = required attendance threshold as a fraction (0.75 for 75%)
 */

export const DEFAULT_THRESHOLD = 75;

/** attendance % = attended / total * 100 (0 when no classes have been held yet). */
export function attendancePercent(attended, total) {
  if (!total || total <= 0) return 0;
  return (attended / total) * 100;
}

/**
 * How many FUTURE classes must be attended consecutively for the percentage to
 * reach the threshold? Solve (attended + k) / (total + k) >= T for the smallest k.
 *   k >= (T * total - attended) / (1 - T)
 */
export function classesNeededToReach(attended, total, thresholdPercent) {
  const T = thresholdPercent / 100;
  const current = attendancePercent(attended, total);

  if (total === 0) return 0;                 // nothing recorded yet - nothing to recover
  if (current >= thresholdPercent) return 0; // already at or above the bar
  if (T >= 1) return Infinity;               // 100% is only reachable if nothing was missed
  if (T <= 0) return 0;

  const raw = (T * total - attended) / (1 - T);
  return Math.max(0, Math.ceil(raw - 1e-9));
}

/**
 * How many classes can the student skip (starting from the next one) and still
 * stay at or above the threshold?
 *   attended / (total + m) >= T   ->   m <= attended / T - total
 */
export function classesThatCanBeMissed(attended, total, thresholdPercent) {
  const T = thresholdPercent / 100;
  if (T <= 0) return Infinity;
  if (total === 0) return 0;
  const maxMissable = attended / T - total;
  return Math.max(0, Math.floor(maxMissable + 1e-9));
}

/** Percentage after missing the next `missed` classes. */
export function percentIfMissed(attended, total, missed) {
  return attendancePercent(attended, total + Math.max(0, missed));
}

/** Percentage after attending the next `attendedNext` classes. */
export function percentIfAttended(attended, total, attendedNext) {
  return attendancePercent(attended + Math.max(0, attendedNext), total + Math.max(0, attendedNext));
}

/** Risk classification used by badges across the UI. */
export function riskLevel(currentPercent, thresholdPercent, total) {
  if (!total) return 'none';                 // no data yet
  if (currentPercent < thresholdPercent) return 'below';
  if (currentPercent < thresholdPercent + 4) return 'at-risk';
  return 'safe';
}

/**
 * Full recovery plan for one student. Returns everything the UI needs to render
 * the Recovery / What-If panel.
 */
export function buildRecoveryPlan(attended, total, thresholdPercent = DEFAULT_THRESHOLD) {
  const threshold = Number(thresholdPercent) || DEFAULT_THRESHOLD;
  const current = attendancePercent(attended, total);
  const below = total > 0 && current < threshold;
  const needed = classesNeededToReach(attended, total, threshold);
  const missable = classesThatCanBeMissed(attended, total, threshold);
  const safeZone = !below && total > 0;
  const atRisk = safeZone && missable === 0;

  return {
    attended,
    total,
    threshold,
    current,
    gap: Math.max(0, threshold - current),
    below,
    atRisk,
    safeZone,
    needed,
    canRecover: Number.isFinite(needed),
    missable,
    hasData: total > 0,
    // "if they miss the next N classes" projection table
    missProjection: [1, 2, 3, 4, 5].map((m) => ({
      missed: m,
      percent: percentIfMissed(attended, total, m),
    })),
    // "if they attend the next N classes" projection table
    attendProjection: [1, 2, 3, 4, 5].map((m) => ({
      attendedNext: m,
      percent: percentIfAttended(attended, total, m),
    })),
  };
}

/** Human sentence for the recovery banner, e.g. "Attend the next 6 classes...". */
export function recoverySentence(plan, name = 'This student') {
  if (!plan.hasData) return `${name} has no attendance recorded for this class yet.`;
  if (!plan.below) {
    return plan.missable > 0
      ? `${name} is above the ${plan.threshold}% requirement and can still miss ${plan.missable} class${plan.missable === 1 ? '' : 'es'} safely.`
      : `${name} is above the ${plan.threshold}% requirement but cannot afford another absence.`;
  }
  if (!plan.canRecover) {
    return `${name} cannot reach ${plan.threshold}% because the requirement is 100%.`;
  }
  return `Attend the next ${plan.needed} consecutive class${plan.needed === 1 ? '' : 'es'} to reach ${plan.threshold}%.`;
}

/** Distribution buckets used by the analytics page. */
export function distributionBuckets(percentages) {
  const buckets = [
    { label: 'Below 50%', tone: 'danger', min: 0, max: 50, count: 0 },
    { label: '50 - 65%', tone: 'danger', min: 50, max: 65, count: 0 },
    { label: '65 - 75%', tone: 'warn', min: 65, max: 75, count: 0 },
    { label: '75 - 90%', tone: 'ok', min: 75, max: 90, count: 0 },
    { label: '90 - 100%', tone: 'ok', min: 90, max: 100.01, count: 0 },
  ];
  for (const value of percentages) {
    const bucket = buckets.find((b) => value >= b.min && value < b.max) || buckets[buckets.length - 1];
    bucket.count += 1;
  }
  return buckets;
}