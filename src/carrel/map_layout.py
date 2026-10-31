"""The meaning map's picture: papers onto a plane by meaning, cut into regions, traced as land.

Ported from Acervo's meaning map (`acervo-llm-dictionary`, `src/acervo/meaning/`), whose
experiment chose every setting here on a real vocabulary; the constants carry its values. It
imports nothing of carrel's: vectors and ids in, the map's body out. `meaning_map.py` keeps the
drawn map, draws it again when the library changes, and has its regions named.

- **The layout** is UMAP with the cosine metric. A small `min_dist` lets related papers clump,
  which turns an even disc into land with sea between it.
- **Stability.** A fixed seed does not keep a map in place: UMAP may return it mirrored. So a new
  layout starts from the previous one (a paper it held begins where it was, a new one beside its
  three nearest held papers) and is then aligned onto it, rotated, reflected, scaled and shifted
  (Procrustes). Nothing is pinned: a paper still goes where its meaning now puts it.
- **Regions** are Ward clustering on the 2-D layout, not on the vectors, so a label sits over
  its points; one tree cut twice, so each neighbourhood lies inside one region. No noise class.
- **Contours**: where the papers are thick, as iso-lines of their density, traced here so the
  page draws them with no library.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

# Bumped whenever a setting that changes the picture changes, so every stored map is drawn again.
LAYOUT_VERSION = "map-1"

NEIGHBOURS = 12
MIN_DIST = 0.1
SEED = 42
SIDE = 1000.0

# Below this many papers regions churn from one layout to the next; such a map shows only papers.
MIN_FOR_REGIONS = 150
NEAREST = 5  # each paper's nearest papers, joined to it when it is selected

LEVELS = (0.16, 0.34, 0.56, 0.8)  # the coast at 16% of the peak density, then the rings inside
BANDWIDTH = 0.055
GRID = 150


def fingerprint(model: str, ids: Sequence[str], vectors: np.ndarray) -> str:
    """Every paper and its vector, the encoder and the layout's settings. Equal fingerprints are
    the same map; anything else is drawn again."""
    digest = hashlib.sha256(f"{LAYOUT_VERSION}\n{model}\n".encode())
    for i in sorted(range(len(ids)), key=lambda i: ids[i]):
        digest.update(ids[i].encode("utf-8") + b"\0")
        digest.update(np.ascontiguousarray(vectors[i], dtype=np.float32).tobytes())
    return digest.hexdigest()[:24]


def counts(n: int) -> tuple[int, int]:
    """How many regions and neighbourhoods a map of `n` papers is cut into: about 10 and 36 for
    a library of two thousand, fewer for a smaller one."""
    regions = max(4, min(10, n // 200))
    return regions, max(2 * regions, min(36, n // 60))


# The layout.


def start(
    vectors: np.ndarray, ids: Sequence[str], previous: Mapping[str, Sequence[float]]
) -> np.ndarray | None:
    """Where each paper begins: where the last map put it, or (a paper it did not hold) at the
    mean of its three nearest papers that it did. None when too little is shared to start from."""
    held = [i for i, paper in enumerate(ids) if paper in previous]
    if len(held) < 3:
        return None
    placed = np.array([previous[ids[i]] for i in held], dtype=float)
    out = np.zeros((len(ids), 2))
    for i, paper in enumerate(ids):
        if paper in previous:
            out[i] = previous[paper]
        else:
            nearest = np.argsort(-(vectors[held] @ vectors[i]))[:3]
            out[i] = placed[nearest].mean(axis=0)
    # UMAP optimises from a start of modest scale; `align` restores the frame afterwards.
    return (out - out.mean(axis=0)) / max(float(out.std()), 1e-9)


def layout(vectors: np.ndarray, init: np.ndarray | None = None) -> np.ndarray:
    """Two coordinates a row, in a SIDE × SIDE square. `init` is where to start, from `start`."""
    n = len(vectors)
    if n == 0:
        return np.zeros((0, 2))
    if n <= 3:
        # Too few for a neighbourhood graph: a paper or three sit apart, in a row.
        return np.array([[SIDE / 2 + (i - (n - 1) / 2) * SIDE / 4, SIDE / 2] for i in range(n)])
    import umap

    reducer = umap.UMAP(
        n_neighbors=min(NEIGHBOURS, n - 1),
        min_dist=MIN_DIST,
        metric="cosine",
        random_state=SEED,
        # A fixed seed is single-threaded anyway; saying so keeps UMAP from warning about it.
        n_jobs=1,
        # A spectral start needs a connected graph, which a handful of papers may not make.
        init=init if init is not None else ("spectral" if n > 20 else "random"),
    )
    return normalise(reducer.fit_transform(vectors))


def normalise(coords: np.ndarray) -> np.ndarray:
    low, high = coords.min(axis=0), coords.max(axis=0)
    scale = SIDE / max(float((high - low).max()), 1e-9)
    return (coords - (low + high) / 2) * scale + SIDE / 2


def procrustes(moving: np.ndarray, fixed: np.ndarray):
    """The rotation (reflection allowed), scale and shift taking `moving` closest to `fixed`."""
    mu_m, mu_f = moving.mean(axis=0), fixed.mean(axis=0)
    a, b = moving - mu_m, fixed - mu_f
    u, s, vt = np.linalg.svd(a.T @ b)
    rotation = u @ vt
    scale = float(s.sum() / max((a**2).sum(), 1e-12))
    return rotation, scale, mu_m, mu_f


def align(
    coords: np.ndarray, ids: Sequence[str], previous: Mapping[str, Sequence[float]]
) -> np.ndarray:
    """`coords` moved onto the previous map's frame, fitted on the papers both hold. With fewer
    than three in common the new map keeps its own frame: three points fix a plane's rotation."""
    shared = [i for i, paper in enumerate(ids) if paper in previous]
    if len(shared) < 3:
        return coords
    fixed = np.array([previous[ids[i]] for i in shared], dtype=float)
    rotation, scale, mu_m, mu_f = procrustes(coords[shared], fixed)
    return (coords - mu_m) @ rotation * scale + mu_f


# Regions.


def cut(coords: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Each point's region and neighbourhood, or None below MIN_FOR_REGIONS."""
    if len(coords) < MIN_FOR_REGIONS:
        return None
    from scipy.cluster.hierarchy import fcluster, linkage

    regions, hoods = counts(len(coords))
    tree = linkage(coords, method="ward")
    return (
        fcluster(tree, regions, criterion="maxclust") - 1,
        fcluster(tree, hoods, criterion="maxclust") - 1,
    )


def ranks(vectors: np.ndarray, hoods: np.ndarray | None) -> np.ndarray:
    """0–1, how central each paper is to its neighbourhood: the order titles are shown in, so the
    middle distance names the papers that best describe each place."""
    if not len(vectors):
        return np.zeros(0)
    if hoods is None:
        similarity = vectors @ vectors.mean(axis=0)
        spread = max(float(similarity.max() - similarity.min()), 1e-9)
        return (similarity - similarity.min()) / spread
    out = np.zeros(len(vectors))
    for hood in np.unique(hoods):
        members = np.where(hoods == hood)[0]
        similarity = vectors[members] @ vectors[members].mean(axis=0)
        order = np.argsort(np.argsort(-similarity))
        out[members] = 1 - order / max(len(members) - 1, 1)
    return out


def neighbours(vectors: np.ndarray, k: int = NEAREST) -> list[list[int]]:
    """Each paper's `k` nearest papers by meaning (not by place on the map), as row indices."""
    if len(vectors) < 2:
        return [[] for _ in range(len(vectors))]
    similarity = vectors @ vectors.T
    np.fill_diagonal(similarity, -np.inf)
    k = min(k, len(vectors) - 1)
    nearest = np.argpartition(-similarity, k - 1, axis=1)[:, :k]
    return [[int(j) for j in row[np.argsort(-similarity[i, row])]] for i, row in enumerate(nearest)]


def folders(topics: Sequence[str], members: Sequence[int], top: int = 2) -> list[str]:
    """The folders most of a region's papers are filed in, by their last part: its name until a
    model writes one, and a hint of how the meaning cuts across the folders."""
    found = Counter(topics[i].split("/")[-1].replace("-", " ") for i in members)
    return [name for name, _ in found.most_common(top)]


def contours(coords: np.ndarray) -> list[list]:
    """`[level, [x, y, x, y, …]]` a line, in map coordinates."""
    if len(coords) < 5:
        return []
    import contourpy
    from scipy.stats import gaussian_kde

    kde = gaussian_kde(coords.T, bw_method=BANDWIDTH)
    low, high = coords.min(axis=0), coords.max(axis=0)
    pad = 0.06 * float((high - low).max())
    xs = np.linspace(low[0] - pad, high[0] + pad, GRID)
    ys = np.linspace(low[1] - pad, high[1] + pad, GRID)
    gx, gy = np.meshgrid(xs, ys)
    density = kde(np.vstack([gx.ravel(), gy.ravel()])).reshape(gx.shape)
    generator = contourpy.contour_generator(gx, gy, density)
    peak = float(density.max())
    out = []
    for level, fraction in enumerate(LEVELS):
        for line in generator.lines(peak * fraction):
            if len(line) < 6:
                continue
            out.append([level, [round(float(v), 1) for point in line[::2] for v in point]])
    return out


# The map.


def build(
    ids: Sequence[str],
    topics: Sequence[str],
    vectors: np.ndarray,
    previous: Mapping[str, Sequence[float]] | None = None,
) -> dict[str, Any]:
    """Positions, regions with their folders, neighbours and contours for these papers.

    `ids` name the papers (their text files), `topics` their folders, `vectors` their unit
    vectors a row; `previous` maps an id to where the last map put it.
    """
    init = start(vectors, ids, previous) if previous and len(ids) > 3 else None
    coords = layout(vectors, init)
    if previous:
        coords = align(coords, ids, previous)
    found = cut(coords)
    region_of, hood_of = found if found is not None else (None, None)
    rank = ranks(vectors, hood_of)
    near = neighbours(vectors)

    regions: list[dict[str, Any]] = []
    if found is not None:
        for level, labels in (("region", region_of), ("hood", hood_of)):
            for index in range(int(labels.max()) + 1):
                members = [i for i in range(len(ids)) if labels[i] == index]
                if not members:
                    continue
                centre = coords[members].mean(axis=0)
                entry: dict[str, Any] = {
                    "id": f"{level[0]}{index}",
                    "level": level,
                    "index": index,
                    "x": round(float(centre[0]), 1),
                    "y": round(float(centre[1]), 1),
                    "count": len(members),
                    "folders": folders(topics, members),
                }
                if level == "hood":
                    entry["region"] = int(region_of[members[0]])
                regions.append(entry)

    points = [
        {
            "id": paper,
            "x": round(float(coords[i][0]), 1),
            "y": round(float(coords[i][1]), 1),
            "r": int(region_of[i]) if found is not None else -1,
            "h": int(hood_of[i]) if found is not None else -1,
            "rank": round(float(rank[i]), 3),
            "near": near[i],
        }
        for i, paper in enumerate(ids)
    ]
    return {
        "side": SIDE,
        "points": points,
        "regions": regions,
        "contours": contours(coords) if found is not None else [],
    }


def members(body: Mapping[str, Any], region: Mapping[str, Any]) -> list[int]:
    """The points of a region or neighbourhood, as indices into the body's points."""
    key = "r" if region["level"] == "region" else "h"
    return [i for i, point in enumerate(body["points"]) if point[key] == region["index"]]


def carry_names(body: dict[str, Any], before: Mapping[str, Any] | None, *, share: float = 0.6):
    """Gives a region the name of the previous map's region of the same level that holds most
    of the same papers, when they share at least `share` of their papers together (Jaccard).
    So a paper added does not rename the map, and a model is asked only about what changed.
    Returns how many regions still have no name."""
    unnamed = 0
    old: dict[str, list[tuple[set[str], str]]] = {"region": [], "hood": []}
    if before:
        for region in before.get("regions", []):
            if region.get("name"):
                ids = {before["points"][i]["id"] for i in members(before, region)}
                old[region["level"]].append((ids, region["name"]))
    taken: set[str] = set()
    for region in body["regions"]:
        ids = {body["points"][i]["id"] for i in members(body, region)}
        best, best_name = 0.0, None
        for held, name in old[region["level"]]:
            overlap = len(ids & held) / max(len(ids | held), 1)
            if overlap > best and name not in taken:
                best, best_name = overlap, name
        if best_name and best >= share:
            region["name"] = best_name
            taken.add(best_name)
        else:
            region.pop("name", None)
            unnamed += 1
    return unnamed


def main(argv: Sequence[str]) -> int:
    """`python -m carrel.map_layout <in.npz> <out.json>`: the map of the papers in `in.npz`
    (`ids`, `topics`, `vectors`, and `previous` as JSON), written to `out.json`. The server runs
    it as a child, so what UMAP imports leaves with the child."""
    import json

    if len(argv) != 2:
        print(main.__doc__)
        return 2
    with np.load(argv[0], allow_pickle=False) as given:
        ids = [str(each) for each in given["ids"]]
        topics = [str(each) for each in given["topics"]]
        vectors = np.asarray(given["vectors"], dtype=np.float32)
        previous = json.loads(str(given["previous"])) or None
    body = build(ids, topics, vectors, previous)
    with open(argv[1], "w", encoding="utf-8") as out:
        json.dump(body, out, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main(sys.argv[1:]))
