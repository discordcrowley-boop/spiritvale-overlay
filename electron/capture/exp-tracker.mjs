/**
 * Spiritvale Exp! tracker — mirrors @kar-mi FishNetMobRewardTracker progressGain.
 *
 * How EXP works in Spiritvale (verified against reward catalog + official tracker):
 * - Base level 1–150, Job level 1–70 (advanced job).
 * - `experienceRequirements[level - 1]` is XP *needed to finish that level* (a span),
 *   NOT a lifetime cumulative total.
 * - ExpCoinsChanged_T sends absolute state: { exp, level, jobExp, jobLevel, coins }
 *   where `exp` / `jobExp` are XP *into the current level* (0 … span).
 * - XP gained between two snapshots = same-level delta, or (span - prev) + next on level-up
 *   (see progressGain below — identical to the stock reward tracker).
 * - Kill XP / party share / penalties are already reflected in ExpCoins; do not add
 *   catalog mob estimates on top.
 */

export const MAX_BASE_LEVEL = 150;
export const MAX_JOB_LEVEL = 70;

/** Same formula as spirit-vale-tools-rewards progressGain. */
export function progressGain(previousLevel, previousProgress, nextLevel, nextProgress, requirements) {
  const pL = Number(previousLevel) || 0;
  const nL = Number(nextLevel) || 0;
  const pX = Number(previousProgress) || 0;
  const nX = Number(nextProgress) || 0;
  if (!(pL >= 1) || !(nL >= 1)) return 0;
  if (nL < pL || pX < 0 || nX < 0) return 0;
  if (nL === pL) return Math.max(0, nX - pX);
  if (!requirements?.length) return Math.max(0, nX);
  let gain = Math.max(0, (requirements[pL - 1] ?? pX) - pX);
  for (let level = pL + 1; level < nL; level += 1) {
    gain += Math.max(0, requirements[level - 1] ?? 0);
  }
  return gain + Math.max(0, nX);
}

/** Span = XP required to advance from `level` to `level + 1`. */
export function levelSpan(level, requirements, maxLevel = MAX_BASE_LEVEL) {
  const lv = Number(level);
  if (!Number.isFinite(lv) || lv < 1) return null;
  if (lv >= maxLevel) return 0;
  const span = Number(requirements?.[lv - 1]);
  return Number.isFinite(span) && span > 0 ? span : null;
}

/**
 * Progress within the current level.
 * ExpCoins `experience` is into-level; also accept accidental cumulative dumps.
 */
export function levelProgress(level, experience, requirements, maxLevel = MAX_BASE_LEVEL) {
  const lv = Number(level);
  if (!Number.isFinite(lv) || lv < 1) return null;
  if (lv >= maxLevel) {
    return { into: 1, span: 1, remain: 0, percent: 100, maxed: true };
  }
  const span = levelSpan(lv, requirements, maxLevel);
  if (span == null) return null;
  let exp = Number(experience) || 0;
  // If a cumulative total slipped in, fold it back into the current span.
  if (exp > span) {
    let cumulative = 0;
    for (let i = 0; i < lv - 1; i += 1) cumulative += Number(requirements[i]) || 0;
    if (exp >= cumulative) exp = exp - cumulative;
  }
  const into = Math.max(0, Math.min(span, exp));
  return {
    into,
    span,
    remain: span - into,
    percent: Math.round((into / span) * 1000) / 10,
    maxed: false,
  };
}

export function createExpTracker(requirements, options = {}) {
  const maxBase = options.maxBaseLevel ?? MAX_BASE_LEVEL;
  const maxJob = options.maxJobLevel ?? MAX_JOB_LEVEL;
  const minRateMs = options.minRateMs ?? 15_000;
  const windowMs = options.windowMs ?? 5 * 60_000;

  let baseline = null;
  let sessionXp = 0;
  let sessionJobXp = 0;
  let startedAt = Date.now();
  let paused = false;
  const samples = [];
  const jobSamples = [];
  let snapshot = {
    level: null,
    experience: null,
    jobLevel: null,
    jobExperience: null,
    known: false,
    updatedAt: 0,
  };

  function prune(list, nowMs) {
    const cutoff = nowMs - windowMs * 2;
    while (list.length && list[0].at < cutoff) list.shift();
  }

  function noteGain(amount, nowMs, job) {
    const n = Number(amount) || 0;
    if (paused || !(n > 0) || n >= 50_000_000) return;
    if (job) {
      sessionJobXp += n;
      jobSamples.push({ at: nowMs, amount: n });
      prune(jobSamples, nowMs);
    } else {
      sessionXp += n;
      samples.push({ at: nowMs, amount: n });
      prune(samples, nowMs);
    }
  }

  function rateFor(list, total, nowMs) {
    prune(list, nowMs);
    const elapsedMs = Math.max(0, nowMs - startedAt);
    const hours = Math.max(minRateMs / 3_600_000, elapsedMs / 3_600_000);
    const sessionRate = (Number(total) || 0) / hours;
    const cutoff = nowMs - windowMs;
    let sum = 0;
    let firstAt = null;
    for (const row of list) {
      if (row.at < cutoff) continue;
      sum += row.amount;
      if (firstAt == null) firstAt = row.at;
    }
    let windowRate = sessionRate;
    if (firstAt != null && sum > 0) {
      const spanMs = Math.max(minRateMs, nowMs - firstAt);
      windowRate = sum / (spanMs / 3_600_000);
    }
    const ready = elapsedMs >= minRateMs && (Number(total) || 0) > 0;
    const rate = Math.round(Math.max(0, Math.min(sessionRate, windowRate)));
    return { rate, ready, total: Number(total) || 0 };
  }

  function adoptLevel(incoming, prior, maxLevel) {
    const next = Number(incoming);
    const prev = Number(prior);
    if (!Number.isFinite(next) || next < 1 || next > maxLevel) {
      return Number.isFinite(prev) && prev >= 1 ? prev : null;
    }
    if (!Number.isFinite(prev) || prev < 1) return next;
    // Ignore implausible drops (junk Level fields).
    if (next + 2 < prev) return prev;
    return next;
  }

  /**
   * Apply an ExpCoins (or equivalent) absolute state. Records XP gained vs baseline.
   */
  function observe(state, nowMs = Date.now()) {
    if (!state) return false;
    if (!startedAt || startedAt > nowMs) startedAt = nowMs;
    const level = adoptLevel(state.level, snapshot.level, maxBase);
    const jobLevel = adoptLevel(state.jobLevel, snapshot.jobLevel, maxJob);

    let experience =
      state.experience != null && Number.isFinite(Number(state.experience))
        ? Number(state.experience)
        : snapshot.experience;
    let jobExperience =
      state.jobExperience != null && Number.isFinite(Number(state.jobExperience))
        ? Number(state.jobExperience)
        : snapshot.jobExperience;

    // ExpCoins level-ups reset into-level XP to 0. Only ignore a bare 0 wipe when
    // level did NOT advance (junk fields). Hints still use hintExperience(0) guard.
    const levelAdvanced =
      Number.isFinite(Number(level)) &&
      Number.isFinite(Number(snapshot.level)) &&
      Number(level) > Number(snapshot.level);
    const jobLevelAdvanced =
      Number.isFinite(Number(jobLevel)) &&
      Number.isFinite(Number(snapshot.jobLevel)) &&
      Number(jobLevel) > Number(snapshot.jobLevel);
    if (
      experience === 0 &&
      Number(snapshot.experience) > 0 &&
      state.experience === 0 &&
      !levelAdvanced
    ) {
      experience = snapshot.experience;
    }
    if (
      jobExperience === 0 &&
      Number(snapshot.jobExperience) > 0 &&
      state.jobExperience === 0 &&
      !jobLevelAdvanced
    ) {
      jobExperience = snapshot.jobExperience;
    }

    const next = {
      level: level ?? snapshot.level,
      experience: experience == null ? snapshot.experience : experience,
      jobLevel: jobLevel ?? snapshot.jobLevel,
      jobExperience: jobExperience == null ? snapshot.jobExperience : jobExperience,
      known:
        (experience != null && Number.isFinite(experience)) ||
        snapshot.known ||
        (level != null && state.experience != null),
      updatedAt: nowMs,
    };

    if (
      baseline &&
      Number(baseline.level) >= 1 &&
      Number(next.level) >= 1 &&
      next.experience != null
    ) {
      const xp = progressGain(
        baseline.level,
        baseline.experience,
        next.level,
        next.experience,
        requirements,
      );
      noteGain(xp, nowMs, false);
      if (Number(next.jobLevel) < maxJob && next.jobExperience != null) {
        const jobXp = progressGain(
          baseline.jobLevel,
          baseline.jobExperience,
          next.jobLevel,
          next.jobExperience,
          requirements,
        );
        noteGain(jobXp, nowMs, true);
      }
    }

    snapshot = next;
    if (Number(next.level) >= 1 && next.experience != null) {
      baseline = {
        level: Number(next.level),
        experience: Number(next.experience) || 0,
        jobLevel: Number(next.jobLevel) || 0,
        jobExperience: Number(next.jobExperience) || 0,
      };
    }
    return true;
  }

  /** Soft level hint from character sync (no XP gain). */
  function hintLevel(level, nowMs = Date.now()) {
    const lv = adoptLevel(level, snapshot.level, maxBase);
    if (lv == null) return;
    snapshot = { ...snapshot, level: lv, updatedAt: nowMs };
  }

  function hintJobLevel(jobLevel, nowMs = Date.now()) {
    const lv = adoptLevel(jobLevel, snapshot.jobLevel, maxJob);
    if (lv == null) return;
    snapshot = { ...snapshot, jobLevel: lv, updatedAt: nowMs };
  }

  /** Soft Exp hint from character sync — only positive bars. */
  function hintExperience(experience, nowMs = Date.now()) {
    const n = Number(experience);
    if (!Number.isFinite(n) || n < 0) return;
    if (n === 0 && Number(snapshot.experience) > 0) return;
    snapshot = {
      ...snapshot,
      experience: n,
      known: n > 0 || snapshot.known,
      updatedAt: nowMs,
    };
    if (!baseline && Number(snapshot.level) >= 1) {
      baseline = {
        level: Number(snapshot.level),
        experience: n,
        jobLevel: Number(snapshot.jobLevel) || 0,
        jobExperience: Number(snapshot.jobExperience) || 0,
      };
    }
  }

  function hintJobExperience(jobExperience, nowMs = Date.now()) {
    const n = Number(jobExperience);
    if (!Number.isFinite(n) || n < 0) return;
    if (n === 0 && Number(snapshot.jobExperience) > 0) return;
    snapshot = { ...snapshot, jobExperience: n, updatedAt: nowMs };
  }

  function reset(nowMs = Date.now()) {
    sessionXp = 0;
    sessionJobXp = 0;
    samples.length = 0;
    jobSamples.length = 0;
    startedAt = nowMs;
    // Keep absolute bar / level — only wipe session rates.
    if (snapshot.level != null && snapshot.experience != null) {
      baseline = {
        level: Number(snapshot.level),
        experience: Number(snapshot.experience) || 0,
        jobLevel: Number(snapshot.jobLevel) || 0,
        jobExperience: Number(snapshot.jobExperience) || 0,
      };
    } else {
      baseline = null;
    }
  }

  /** While paused the bar stays current but no XP counts toward the session. */
  function setPaused(flag) {
    paused = Boolean(flag);
  }

  /** Move the session clock forward so paused time is excluded from XP/hr. */
  function shiftClock(ms) {
    const d = Number(ms) || 0;
    if (!(d > 0)) return;
    startedAt += d;
    for (const row of samples) row.at += d;
    for (const row of jobSamples) row.at += d;
  }

  function serialize(nowMs = Date.now()) {
    const level = Number(snapshot.level);
    const jobLevel = Number(snapshot.jobLevel);
    const levelOk = Number.isFinite(level) && level >= 1;
    const jobOk = Number.isFinite(jobLevel) && jobLevel >= 1;
    const baseMaxed = levelOk && level >= maxBase;
    const jobMaxed = jobOk && jobLevel >= maxJob;
    const base = levelOk
      ? levelProgress(level, snapshot.experience, requirements, maxBase)
      : null;
    const job = jobOk
      ? levelProgress(jobLevel, snapshot.jobExperience, requirements, maxJob)
      : null;
    const baseRate = rateFor(samples, sessionXp, nowMs);
    const jobRate = rateFor(jobSamples, sessionJobXp, nowMs);
    const xpPerHour = baseMaxed ? 0 : baseRate.rate;
    const jobXpPerHour = jobMaxed ? 0 : jobRate.rate;
    const ttlMs =
      !baseMaxed &&
      baseRate.ready &&
      base &&
      base.remain > 0 &&
      xpPerHour > 0
        ? Math.round((base.remain / xpPerHour) * 3_600_000)
        : null;
    const jobTtlMs =
      !jobMaxed &&
      jobRate.ready &&
      job &&
      job.remain > 0 &&
      jobXpPerHour > 0
        ? Math.round((job.remain / jobXpPerHour) * 3_600_000)
        : null;

    return {
      level: levelOk ? level : null,
      jobLevel: jobOk ? jobLevel : null,
      experience: snapshot.experience,
      jobExperience: snapshot.jobExperience,
      known: Boolean(snapshot.known && base),
      baseMaxed,
      jobMaxed,
      maxBaseLevel: maxBase,
      maxJobLevel: maxJob,
      xp: baseRate.total,
      jobXp: jobRate.total,
      xpPerHour,
      jobXpPerHour,
      xpToLevel: base && !baseMaxed ? base.remain : baseMaxed ? 0 : null,
      xpPercent: base ? base.percent : null,
      ttlMs,
      jobXpToLevel: job && !jobMaxed ? job.remain : jobMaxed ? 0 : null,
      jobXpPercent: job ? job.percent : null,
      jobTtlMs,
    };
  }

  return {
    observe,
    hintLevel,
    hintJobLevel,
    hintExperience,
    hintJobExperience,
    reset,
    setPaused,
    shiftClock,
    serialize,
    get baseline() {
      return baseline;
    },
    get snapshot() {
      return { ...snapshot };
    },
  };
}
