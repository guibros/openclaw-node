#!/usr/bin/env python3
"""
Fitness score computation for Daedalus genome evolution.

Aggregates signals from available data sources to produce a
composite fitness score (0.0 - 1.0) for a given evaluation window.

Usage:
  python3 bin/fitness_score.py [--days N] [--json]

Data sources (graceful degradation if unavailable):
  - .learnings/lessons.md        → correction events (negative signal)
  - memory/active-tasks.md       → task completion rate (positive signal)
  - memory/YYYY-MM-DD.md         → daily note correction keywords
  - memory/predictions.md        → prediction calibration (positive signal)
  - ~/.spark/                    → Spark tool metrics (if installed)
"""

import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

WORKSPACE = Path(__file__).parent.parent
LESSONS_FILE = WORKSPACE / ".learnings" / "lessons.md"
ACTIVE_TASKS_FILE = WORKSPACE / "memory" / "active-tasks.md"
PREDICTIONS_FILE = WORKSPACE / "memory" / "predictions.md"
MEMORY_DIR = WORKSPACE / "memory"
SPARK_DIR = Path.home() / ".spark"
BASELINE_FILE = WORKSPACE / ".tmp" / "evolve-baseline.json"

# Keywords in daily notes that suggest a correction event
CORRECTION_KEYWORDS = [
    "wrong", "mistake", "redo", "actually", "not what i asked",
    "incorrect", "no do it", "that's not", "try again", "revert",
    "that's wrong", "bad output", "hallucinated", "made up",
]


# ── Data parsers ──────────────────────────────────────────────────────────────

def parse_lessons(since_date=None):
    """
    Parse .learnings/lessons.md.
    Returns: (total_lessons, total_corrections, recent_corrections)
    """
    if not LESSONS_FILE.exists():
        return 0, 0, 0

    text = LESSONS_FILE.read_text(encoding="utf-8")
    lines = [l.strip() for l in text.split("\n") if l.strip().startswith("[")]

    total = len(lines)
    total_corrections = sum(1 for l in lines if l.startswith("[correction]"))

    recent_corrections = 0
    if since_date:
        date_re = re.compile(r"\((\d{4}-\d{2}-\d{2})\)")
        for line in lines:
            if not line.startswith("[correction]"):
                continue
            m = date_re.search(line)
            if m:
                try:
                    d = datetime.strptime(m.group(1), "%Y-%m-%d").date()
                    if d >= since_date:
                        recent_corrections += 1
                except ValueError:
                    pass
            else:
                # Undated correction — count it if we're looking at recent
                recent_corrections += 1

    return total, total_corrections, recent_corrections


def parse_task_outcomes():
    """
    Parse memory/active-tasks.md.
    Returns: (done, failed, blocked, completion_rate)
    """
    if not ACTIVE_TASKS_FILE.exists():
        return 0, 0, 0, 0.5  # neutral default

    text = ACTIVE_TASKS_FILE.read_text(encoding="utf-8")

    done = len(re.findall(r"status:\s*done", text))
    failed = len(re.findall(r"status:\s*failed", text))
    blocked = len(re.findall(r"status:\s*blocked", text))

    total_terminal = done + failed
    completion_rate = done / total_terminal if total_terminal > 0 else 0.5

    return done, failed, blocked, completion_rate


def scan_daily_notes(days=7):
    """
    Scan recent daily memory files for correction keywords.
    Returns: (total_hits, days_scanned, normalized_penalty 0.0-1.0)
    """
    cutoff = datetime.now().date() - timedelta(days=days)
    hits = 0
    scanned = 0

    for f in sorted(MEMORY_DIR.glob("????-??-??.md")):
        try:
            file_date = datetime.strptime(f.stem, "%Y-%m-%d").date()
            if file_date < cutoff:
                continue
            text = f.read_text(encoding="utf-8").lower()
            scanned += 1
            hits += sum(text.count(kw) for kw in CORRECTION_KEYWORDS)
        except (ValueError, OSError):
            continue

    # Normalize: 0 hits = 1.0, 5+ hits/day = 0.0
    threshold = max(1, scanned) * 5
    normalized = max(0.0, 1.0 - hits / threshold)
    return hits, scanned, normalized


def parse_predictions():
    """
    Parse memory/predictions.md for calibration signal.
    Returns: (total_closed, accurate, closure_rate, calibration_score)

    Calibration score rewards:
      - Closing predictions (filling in outcomes) = discipline signal
      - Accurate predictions (outcome matches confidence) = calibration signal
    """
    if not PREDICTIONS_FILE.exists():
        return 0, 0, 0.0, None  # None = no data, skip this signal

    text = PREDICTIONS_FILE.read_text(encoding="utf-8")

    # Count predictions by looking for ### YYYY-MM-DD entries
    prediction_blocks = re.split(r"(?=^### \d{4}-\d{2}-\d{2})", text, flags=re.MULTILINE)
    prediction_blocks = [b for b in prediction_blocks if b.strip().startswith("### ")]

    if not prediction_blocks:
        return 0, 0, 0.0, None

    total = len(prediction_blocks)
    closed = 0
    accurate = 0

    for block in prediction_blocks:
        # A prediction is "closed" if Outcome has content on the same line
        outcome_match = re.search(r"\*\*Outcome:\*\*[ \t]*(.+)", block)
        if not outcome_match or not outcome_match.group(1).strip():
            continue
        outcome_text = outcome_match.group(1).strip()
        if outcome_text.startswith("[expired"):
            continue  # Expired predictions don't count for calibration

        closed += 1

        # Check if delta/lesson are also filled — indicates thorough analysis
        delta_match = re.search(r"\*\*Delta:\*\*[ \t]*(.+)", block)
        lesson_match = re.search(r"\*\*Lesson:\*\*[ \t]*(.+)", block)
        if delta_match and delta_match.group(1).strip() and \
           lesson_match and lesson_match.group(1).strip():
            accurate += 1  # "accurate" here means "fully analyzed"

    closure_rate = closed / total if total > 0 else 0.0

    # Calibration score: 50% for closing predictions, 50% for full analysis
    # Need at least 1 closed prediction to produce a signal — 0 closed = not enough data, not bad calibration
    if closed == 0:
        calibration_score = None
    else:
        analysis_rate = accurate / closed
        calibration_score = (closure_rate * 0.5) + (analysis_rate * 0.5)

    return total, closed, closure_rate, calibration_score


def read_spark_metrics():
    """
    Read Spark bridge heartbeat for tool quality metrics.
    Returns dict or None if Spark not installed.
    """
    candidates = [
        SPARK_DIR / "logs" / "bridge_heartbeat.json",
        SPARK_DIR / "bridge_heartbeat.json",
    ]
    for path in candidates:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                stats = data.get("stats", {})
                errors = len(stats.get("errors", []))
                processed = max(1, stats.get("pattern_processed", 0))
                return {
                    "content_learned": stats.get("content_learned", 0),
                    "pattern_processed": processed,
                    "error_rate": errors / processed,
                }
            except (json.JSONDecodeError, OSError):
                pass
    return None


def load_baseline():
    """Load previous evolution baseline for delta comparison."""
    if not BASELINE_FILE.exists():
        return None
    try:
        return json.loads(BASELINE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


# ── Composite score ───────────────────────────────────────────────────────────

def compute_fitness(days=7):
    """
    Compute composite fitness score (0.0 - 1.0).

    Base weights (no optional signals):
      Task completion rate:   0.45
      Correction score:       0.40
      Daily signal score:     0.15

    With prediction calibration:
      Task completion rate:   0.40
      Correction score:       0.35
      Daily signal score:     0.15
      Prediction calibration: 0.10

    With Spark (stacks with prediction):
      Prediction shifts weights down by 0.05 each from task + correction.
      Spark shifts weights down by 0.05 each from task + correction.
    """
    baseline = load_baseline()
    since_date = (datetime.now() - timedelta(days=days)).date()

    total_lessons, total_corrections, recent_corrections = parse_lessons(since_date)
    done, failed, blocked, completion_rate = parse_task_outcomes()
    daily_hits, days_scanned, daily_score = scan_daily_notes(days)
    pred_total, pred_closed, pred_closure_rate, calibration_score = parse_predictions()
    spark = read_spark_metrics()

    # Correction score: penalize heavily for recent corrections
    # 0 corrections = 1.0, 3+ recent corrections = ~0.0
    correction_penalty = min(1.0, recent_corrections / 3.0)
    correction_score = max(0.0, 1.0 - correction_penalty)

    # Spark quality score
    spark_score = None
    if spark:
        spark_score = max(0.0, 1.0 - spark["error_rate"] * 2)

    # Weighted composite — optional signals steal weight from task + correction
    w_task = 0.45
    w_correction = 0.40
    w_daily = 0.15
    w_calibration = 0.0
    w_spark = 0.0

    if calibration_score is not None:
        w_calibration = 0.10
        w_task -= 0.05
        w_correction -= 0.05

    if spark_score is not None:
        w_spark = 0.10
        w_task -= 0.05
        w_correction -= 0.05

    fitness = (
        completion_rate * w_task
        + correction_score * w_correction
        + daily_score * w_daily
        + (calibration_score or 0) * w_calibration
        + (spark_score or 0) * w_spark
    )

    fitness = round(min(1.0, max(0.0, fitness)), 3)

    delta = None
    if baseline:
        prev = baseline.get("fitness_score")
        if prev is not None:
            delta = round(fitness - prev, 3)

    return {
        "score": fitness,
        "grade": _grade(fitness),
        "delta": delta,
        "window_days": days,
        "breakdown": {
            "task_completion_rate": round(completion_rate, 3),
            "correction_score": round(correction_score, 3),
            "daily_signal_score": round(daily_score, 3),
            "calibration_score": round(calibration_score, 3) if calibration_score is not None else None,
            "spark_quality_score": round(spark_score, 3) if spark_score is not None else None,
        },
        "raw": {
            "tasks_done": done,
            "tasks_failed": failed,
            "tasks_blocked": blocked,
            "lessons_total": total_lessons,
            "corrections_recent": recent_corrections,
            "daily_keyword_hits": daily_hits,
            "days_scanned": days_scanned,
            "predictions_total": pred_total,
            "predictions_closed": pred_closed,
            "spark_installed": spark is not None,
        },
        "baseline": baseline,
    }


def _grade(score):
    if score >= 0.85:
        return "A"
    if score >= 0.75:
        return "B"
    if score >= 0.65:
        return "C"
    if score >= 0.50:
        return "D"
    return "F"


# ── CLI output ────────────────────────────────────────────────────────────────

def print_report(report):
    score = report["score"]
    grade = report["grade"]
    delta = report["delta"]

    delta_str = ""
    if delta is not None:
        arrow = "▲" if delta > 0 else ("▼" if delta < 0 else "→")
        delta_str = f"  {arrow} {delta:+.3f} vs baseline"

    print(f"\nFitness Score: {score:.3f}  [{grade}]{delta_str}")
    print("─" * 44)

    b = report["breakdown"]
    r = report["raw"]

    print(
        f"  Task completion:  {b['task_completion_rate']:.1%}"
        f"  ({r['tasks_done']} done, {r['tasks_failed']} failed, {r['tasks_blocked']} blocked)"
    )
    print(
        f"  Correction score: {b['correction_score']:.3f}"
        f"  ({r['corrections_recent']} recent corrections in {report['window_days']}d)"
    )
    print(
        f"  Daily signal:     {b['daily_signal_score']:.3f}"
        f"  ({r['daily_keyword_hits']} keyword hits across {r['days_scanned']} day files)"
    )

    if b["calibration_score"] is not None:
        print(
            f"  Calibration:      {b['calibration_score']:.3f}"
            f"  ({r['predictions_closed']}/{r['predictions_total']} predictions closed)"
        )
    else:
        print(f"  Calibration:      n/a  ({r['predictions_total']} predictions, too few closed)")

    if b["spark_quality_score"] is not None:
        print(f"  Spark quality:    {b['spark_quality_score']:.3f}")
    else:
        print("  Spark quality:    n/a  (not installed)")

    if report["baseline"]:
        bl = report["baseline"]
        print(f"\n  Baseline: {bl.get('date', 'unknown')}  score={bl.get('fitness_score', '?')}  genome={bl.get('genome', '?')}")
    else:
        print("\n  No baseline yet. Run `bin/evolve --genome soul` to establish one.")

    print()


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Compute Daedalus genome fitness score")
    ap.add_argument("--days", type=int, default=7, help="Lookback window in days (default: 7)")
    ap.add_argument("--json", action="store_true", help="Output raw JSON")
    args = ap.parse_args()

    result = compute_fitness(days=args.days)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print_report(result)
