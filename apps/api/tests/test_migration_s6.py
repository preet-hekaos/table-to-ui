"""S6: definitions saved before the redesign open and behave the same."""

from tableui.metadata.public import FieldDef, TableDef, validate_record


def test_an_old_default_opens_as_an_if_blank_rule_and_behaves_the_same() -> None:
    f = FieldDef.model_validate(
        {
            "key": "mode",
            "label": "Mode",
            "type": "select",
            "options": ["Phone", "Video"],
            "default": "Video",
        }
    )
    assert f.default is None
    assert [(r.when, r.do, r.value, r.stop) for r in f.transforms] == [
        ("blank", "set", "Video", True)
    ]
    t = TableDef.model_validate(
        {
            "key": "interview",
            "label": "Interview",
            "plural_label": "Interviews",
            "title_field": "mode",
            "fields": [f.model_dump(mode="json")],
        }
    )
    clean, errors = validate_record(t, {}, partial=False)
    assert not errors and clean["mode"] == "Video"
    clean, errors = validate_record(t, {"mode": "Phone"}, partial=False)
    assert clean["mode"] == "Phone"


def test_old_defaults_of_other_types_and_the_source_marker() -> None:
    n = FieldDef.model_validate(
        {"key": "n", "label": "N", "type": "integer", "default": 30, "source": "pack"}
    )
    b = FieldDef.model_validate({"key": "b", "label": "B", "type": "boolean", "default": True})
    t = TableDef.model_validate(
        {
            "key": "x",
            "label": "X",
            "plural_label": "Xs",
            "title_field": "n",
            "fields": [n.model_dump(mode="json"), b.model_dump(mode="json")],
        }
    )
    clean, errors = validate_record(t, {}, partial=False)
    assert not errors and clean == {"n": 30, "b": True}


def test_a_definition_that_already_has_the_rule_is_not_changed_again() -> None:
    raw = {
        "key": "mode",
        "label": "Mode",
        "type": "text",
        "transforms": [{"when": "blank", "do": "set", "value": "A", "stop": True}],
    }
    once = FieldDef.model_validate(raw)
    again = FieldDef.model_validate(once.model_dump(mode="json"))
    assert once == again
