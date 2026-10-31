"""The meaning map: its layout and regions (map_layout.py), the drawn map kept and named
(meaning_map.py), and `/api/map`."""

import json
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from starlette.testclient import TestClient

from carrel import map_layout
from carrel.catalog import Catalog
from carrel.meaning import Meaning
from carrel.meaning_map import MeaningMap, names_request, parse_names
from carrel.server import make_app


def clusters(n_clusters=4, each=45, dims=24, seed=1):
    """Unit vectors in `n_clusters` tight groups, and their ids and folders."""
    rng = np.random.default_rng(seed)
    centres = rng.normal(size=(n_clusters, dims))
    rows, ids, topics = [], [], []
    for c in range(n_clusters):
        for i in range(each):
            rows.append(centres[c] + 0.15 * rng.normal(size=dims))
            ids.append(f"library/t{c}/paper {c}-{i}.txt")
            topics.append(f"area-{c % 2}/topic-{c}")
    vectors = np.array(rows, dtype=np.float32)
    return ids, topics, vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def wait(meaning_map: MeaningMap, seconds=120):
    end = time.monotonic() + seconds
    while meaning_map.drawing and time.monotonic() < end:
        time.sleep(0.05)
    assert not meaning_map.drawing


# The layout.


def test_alignment_undoes_a_rotation_a_reflection_a_scale_and_a_shift():
    rng = np.random.default_rng(0)
    before = rng.uniform(0, 1000, size=(30, 2))
    turn = np.array([[0, 1], [1, 0]]) @ np.array([[0.6, -0.8], [0.8, 0.6]])
    after = before @ turn * 0.3 + [40, -7]
    ids = [str(i) for i in range(30)]
    previous = {i: tuple(p) for i, p in zip(ids, before)}
    assert np.allclose(map_layout.align(after, ids, previous), before, atol=1e-6)
    # Fewer than three in common: the new map keeps its frame.
    assert np.array_equal(map_layout.align(after, ids, {"0": (1, 1)}), after)


def test_a_new_paper_starts_beside_its_nearest_held_papers():
    vectors = np.eye(4, dtype=np.float32)
    vectors[3] = (vectors[0] + 0.1 * vectors[1]) / np.linalg.norm(vectors[0] + 0.1 * vectors[1])
    previous = {"a": (0, 0), "b": (10, 0), "c": (0, 10)}
    start = map_layout.start(vectors, ["a", "b", "c", "new"], previous)
    # The start is rescaled; the new paper sits at the mean of the three held ones.
    assert np.allclose(start[3], start[:3].mean(axis=0))
    assert map_layout.start(vectors, ["a", "x", "y", "z"], previous) is None


def test_regions_are_cut_twice_from_one_tree_and_only_on_a_large_map():
    ids, topics, vectors = clusters()
    coords = np.vstack([v[:2] * 1000 for v in vectors])
    assert map_layout.cut(coords[:149]) is None
    regions, hoods = map_layout.cut(coords)
    assert len(set(regions)) == 4 and len(set(hoods)) == 8
    # Every neighbourhood lies inside one region.
    for hood in set(hoods):
        assert len(set(regions[hoods == hood])) == 1


def test_a_papers_neighbours_are_the_nearest_others_nearest_first():
    vectors = np.array([[1, 0], [0.9, 0.1], [0, 1], [0.6, 0.4]], dtype=np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    near = map_layout.neighbours(vectors, k=2)
    assert near[0] == [1, 3] and all(i not in row for i, row in enumerate(near))
    assert map_layout.neighbours(vectors[:1]) == [[]]


def test_the_fingerprint_is_the_papers_and_their_vectors_in_any_order():
    ids, _, vectors = clusters(n_clusters=1, each=5)
    first = map_layout.fingerprint("m", ids, vectors)
    assert map_layout.fingerprint("m", ids[::-1], vectors[::-1]) == first
    assert map_layout.fingerprint("other", ids, vectors) != first
    changed = vectors.copy()
    changed[2, 0] += 0.01
    assert map_layout.fingerprint("m", ids, changed) != first


def test_a_map_is_drawn_and_drawn_again_close_to_where_it_was():
    ids, topics, vectors = clusters()
    body = map_layout.build(ids, topics, vectors)
    assert len(body["points"]) == 180 and body["contours"]
    regions = [r for r in body["regions"] if r["level"] == "region"]
    assert len(regions) == 4 and sum(r["count"] for r in regions) == 180
    # A region's folders are its papers' own: the four groups are four folders.
    assert sorted(r["folders"][0] for r in regions) == [f"topic {c}" for c in range(4)]
    point = body["points"][0]
    assert set(point) == {"id", "x", "y", "r", "h", "rank", "near"} and len(point["near"]) == 5

    # One paper more: the papers already there move little.
    previous = {p["id"]: (p["x"], p["y"]) for p in body["points"]}
    extra = (vectors[0] + vectors[1]) / np.linalg.norm(vectors[0] + vectors[1])
    again = map_layout.build(
        ids + ["library/new.txt"], topics + ["t0"], np.vstack([vectors, extra]), previous
    )
    moved = [
        np.hypot(p["x"] - previous[p["id"]][0], p["y"] - previous[p["id"]][1])
        for p in again["points"][:-1]
    ]
    assert np.median(moved) < 150  # of a map 1,000 across


def test_a_region_keeps_the_name_of_the_region_it_mostly_was():
    def body(groups, names=None):
        points = [
            {"id": paper, "r": r, "h": r} for r, group in enumerate(groups) for paper in group
        ]
        regions = [
            {"id": f"r{r}", "level": "region", "index": r, **({"name": names[r]} if names else {})}
            for r in range(len(groups))
        ]
        return {"points": points, "regions": regions}

    before = body([["a", "b", "c", "d"], ["e", "f", "g", "h"]], ["memory", "agents"])
    # The first group gains a paper, the second is split and mostly new.
    after = body([["a", "b", "c", "d", "x"], ["e", "y", "z", "w"]])
    assert map_layout.carry_names(after, before) == 1
    assert after["regions"][0]["name"] == "memory" and "name" not in after["regions"][1]
    assert map_layout.carry_names(body([["a"]]), None) == 1


# The names.


def test_the_naming_request_asks_only_about_regions_without_a_name():
    stored = {
        "points": [
            {"id": "p1", "r": 0, "h": 0, "rank": 0.2},
            {"id": "p2", "r": 0, "h": 0, "rank": 0.9},
            {"id": "p3", "r": 1, "h": 1, "rank": 1.0},
        ],
        "regions": [
            {"id": "r0", "level": "region", "index": 0},
            {"id": "h1", "level": "hood", "index": 1, "region": 1},
            {"id": "r1", "level": "region", "index": 1, "name": "kept name"},
        ],
    }
    papers = {
        "p1": {"title": "First   paper"},
        "p2": {"title": "Second paper"},
        "p3": {"title": "Third"},
    }
    asked = names_request(stored, papers)
    assert asked.startswith("Names already on the map: kept name")
    assert "## r0: region\n- Second paper\n- First paper" in asked  # most central first
    assert "## h1: hood (inside r1)\n- Third" in asked and "## r1" not in asked


def test_a_reply_is_read_with_suspicion():
    reply = {"r0": "  agent   memory. ", "r9": "invented", "h1": 7, "h2": "", "h3": "a b " * 30}
    named = parse_names(reply, ["r0", "h1", "h2", "h3"])
    assert named["r0"] == "agent memory"
    assert set(named) == {"r0", "h3"}
    assert len(named["h3"]) <= 40 and not named["h3"].endswith(" ")
    assert parse_names("not json", ["r0"]) == {}


# Kept, drawn in the background, and named.


class FakeMeaning:
    """What MeaningMap reads of carrel's Meaning: the vectors, the encoder's model, the library."""

    def __init__(self, ids, topics, vectors):
        self.ids, self.vectors = ids, vectors
        self.encoder = SimpleNamespace(model="test/fake")
        self.library = SimpleNamespace(
            root=Path("/nowhere/library"), lib=SimpleNamespace(CONFIG={})
        )
        papers = {i: {"topic": t, "title": f"Title of {i}"} for i, t in zip(ids, topics)}
        self.built = SimpleNamespace(papers=papers)

    def snapshot(self):
        return self.ids, self.vectors, self.built


def test_the_map_is_drawn_then_named_and_a_new_paper_renames_nothing():
    ids, topics, vectors = clusters()
    asked = []

    def namer(prompt, wanted):
        asked.append(list(wanted))
        return {key: f"place {key}" for key in wanted}

    meaning = FakeMeaning(ids, topics, vectors)
    meaning_map = MeaningMap(meaning, namer=namer, child=False)
    assert meaning_map.current() is None and meaning_map.drawing
    wait(meaning_map)
    served = meaning_map.current()
    body = json.loads(served.body)
    assert body["names"] == "ready" and not body["drawing"]
    assert all(region["name"] == f"place {region['id']}" for region in body["regions"])
    assert served.etag.endswith('.ready.0"') and served.gzipped
    assert len(asked) == 1 and len(asked[0]) == len(body["regions"])

    # A paper added: the map is answered at once, saying it is being drawn again.
    meaning.ids = ids + ["library/t0/new.txt"]
    meaning.vectors = np.vstack([vectors, vectors[:1]])
    stale = json.loads(meaning_map.current().body)
    assert stale["fingerprint"] == body["fingerprint"] and stale["drawing"]
    wait(meaning_map)
    again = json.loads(meaning_map.current().body)
    assert again["fingerprint"] != body["fingerprint"] and len(again["points"]) == 181
    # The regions kept their names; only a region that changed much would be asked about.
    kept = sum(1 for r in again["regions"] if r["name"] in {x.get("name") for x in body["regions"]})
    assert kept >= len(again["regions"]) - 4
    assert len(asked) == 1 or len(asked[1]) < len(again["regions"])


def test_a_failed_naming_leaves_the_folders_and_is_not_asked_again():
    ids, topics, vectors = clusters()

    def namer(prompt, wanted):
        raise RuntimeError("no network")

    meaning_map = MeaningMap(FakeMeaning(ids, topics, vectors), namer=namer, child=False)
    meaning_map.current()
    wait(meaning_map)
    body = json.loads(meaning_map.current().body)
    assert body["names"] == "none" and not meaning_map.drawing
    assert all("name" not in region and region["folders"] for region in body["regions"])


# The route, on the test library, drawn in a child process as the server draws it.


@pytest.fixture
def client(library, words):
    catalog = Catalog(library)
    meaning = Meaning(library, catalog, encoder=words)
    meaning_map = MeaningMap(meaning, namer=lambda prompt, ids: {})
    app = make_app(library, catalog=catalog, meaning=meaning, meaning_map=meaning_map)
    client = TestClient(app, base_url="http://127.0.0.1:8517")
    client.meaning_map = meaning_map
    return client


def test_the_map_route(client):
    first = client.get("/api/map")
    assert first.status_code == 202 and first.json() == {"drawing": True}
    wait(client.meaning_map)
    drawn = client.get("/api/map", headers={"Accept-Encoding": "identity"})
    assert drawn.status_code == 200 and drawn.headers["cache-control"] == "no-cache"
    body = drawn.json()
    # Three papers with a PDF: a row of points, no regions to name.
    assert len(body["points"]) == 3 and body["regions"] == [] and body["names"] == "none"
    assert {p["id"] for p in body["points"]} == {
        "library/recsys/Wide & Deep. A Test Paper.txt",
        "library/llm/post-training/preference-learning/Direct Preference Optimization. Your Language Model is Secretly a Reward Model.txt",
        "library/llm/memory/parametric/Larimar. Large Language Models with Episodic Memory Control.txt",
    }
    again = client.get("/api/map", headers={"If-None-Match": drawn.headers["etag"]})
    assert (again.status_code, again.content) == (304, b"")
    packed = client.get("/api/map", headers={"Accept-Encoding": "gzip"})
    assert packed.headers["content-encoding"] == "gzip" and packed.json() == body
