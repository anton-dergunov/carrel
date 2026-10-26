import pytest

from carrel.settings import DEFAULTS, LONGEST_NOTE, Settings, checked, load, model


def test_the_defaults_when_nothing_is_saved_or_it_cannot_be_read(tmp_path):
    path = tmp_path / "settings.json"
    assert load(path) == DEFAULTS
    path.write_text("{not json")
    assert load(path) == DEFAULTS
    path.write_text('{"note": 3}')
    assert load(path) == DEFAULTS


@pytest.mark.parametrize("values", [[], {"note": 3}, {"note": "x" * (LONGEST_NOTE + 1)}])
def test_what_does_not_fit(values):
    with pytest.raises(ValueError):
        checked(values)


def test_saved_and_read_again(tmp_path):
    path = tmp_path / "state" / "settings.json"
    settings = Settings(path)
    assert settings.update({"note": "A reader of papers.", "other": 1}) == {
        "note": "A reader of papers."
    }
    assert Settings(path).get() == {"note": "A reader of papers."}
    with pytest.raises(ValueError):
        settings.update({"note": None})
    assert Settings(path).get()["note"] == "A reader of papers."
    assert [file.name for file in path.parent.iterdir()] == ["settings.json"]


def test_a_model_a_page_names():
    assert [model(name) for name in ("haiku", "sonnet", "gpt", None, 3)] == [
        "haiku",
        "sonnet",
        "opus",
        "opus",
        "opus",
    ]
