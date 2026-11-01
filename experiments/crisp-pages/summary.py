"""What the picks say so far: for each device (and its own contrast setting), knob and kind of page, how often the baseline,
no difference, or each strength was picked.

    uv run python experiments/crisp-pages/summary.py [--round 1] [--device boox]

Reads picks.jsonl and measurements.jsonl and prints Markdown tables for the README. A device is
the name typed into the bench's form (else its user agent's).
"""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent


def records(name: str) -> list[dict]:
    path = HERE / name
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


# The tablet's own settings, as the bench's form names them.
SETTINGS = ("contrast", "enhance", "dither", "refresh", "notes")


def device_of(record: dict) -> str:
    """The device's name as typed in the bench, with its own settings as typed (the colour mode
    went into Refresh, or into Notes), so picks made under different settings are counted apart."""
    tablet = record.get("tablet") or {}
    name = tablet.get("device") or record["device"]["userAgent"][:40]
    settings = [f"{key} {tablet[key]}" for key in SETTINGS if tablet.get(key)]
    return f"{name} ({'; '.join(settings)})" if settings else name


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--round", type=int)
    parser.add_argument("--device")
    args = parser.parse_args()

    picks = [p for p in records("picks.jsonl") if args.round in (None, p["round"])]
    if args.device:
        picks = [p for p in picks if args.device.lower() in device_of(p).lower()]
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for pick in picks:
        groups[(device_of(pick), pick["knob"], pick["base"], pick["cropKind"])].append(pick)

    print("| Device | Knob | Over | Kind | Screens | Baseline | Same | Picked |")
    print("|---|---|---|---|---|---|---|---|")
    for (device, knob, base, kind), group in sorted(groups.items()):
        chosen = Counter()
        baseline = same = 0
        for pick in group:
            if pick["pick"] == "same":
                same += 1
            elif pick["pickedBaseline"]:
                baseline += 1
            else:
                cell = next(c for c in pick["cells"] if c["label"] == pick["pick"])
                chosen[cell["what"]] += 1
        picked = "; ".join(f"{what} ×{n}" for what, n in chosen.most_common())
        print(
            f"| {device} | {knob} | {base} | {kind} | {len(group)} | {baseline} | {same} | {picked} |"
        )

    measured = records("measurements.jsonl")
    if measured:
        print(
            "\n| Device | Paper | Glyphs | Cap | Canvas | Share of device pixels | Drawn (ms) | After a turn (ms) |"
        )
        print("|---|---|---|---|---|---|---|---|")
        for m in measured:
            for detail in (False, True):
                events = [e for e in m["events"] if e["detail"] == detail and e["ofDevice"]]
                if not events:
                    continue
                share = sorted(e["ofDevice"] for e in events)[len(events) // 2]
                drawn = sorted(e["drawMs"] or 0 for e in events)[len(events) // 2]
                after = sorted(e["afterTurnMs"] for e in events)[len(events) // 2]
                print(
                    f"| {device_of(m)} | {m['crop']} | {m.get('fonts', 'face')} | {m['cap']} "
                    f"| {'detail' if detail else 'page'} "
                    f"| {share:.0%} | {drawn} | {after} |"
                )


if __name__ == "__main__":
    main()
