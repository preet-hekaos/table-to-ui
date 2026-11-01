"""The settings register (S0 of the Studio table redesign).

Every property of a field and every table feature flag is listed here with the places it must take effect once
the owner publishes it, and the tests that prove it. `test_live_effects_gate.py` fails when a setting is missing
from this file, when a named test does not exist, or when the number of gaps grows.

Levels
  live    a Studio -> publish -> live-screen scenario (Playwright) proves it, as a second user
  server  a server test proves the live API enforces it, but no screen-level scenario exists yet
  gap     nothing proves it yet; `stage` says which redesign stage closes the gap

S6 requires zero gaps and every entry at `live`.
"""

from dataclasses import dataclass, field

FORM, LIST, INLINE, IMPORT, BULK, EXPORT, API, SEARCH, CHART, STATS = (
    "form", "list", "inline_edit", "import", "bulk", "export", "api", "search", "chart", "stats",
)  # fmt: skip


@dataclass(frozen=True)
class Setting:
    level: str
    surfaces: tuple[str, ...]
    proofs: tuple[str, ...] = ()  # "api:test_file.py::test_name" or "e2e:spec.ts::test title"
    stage: str = ""  # for a gap: the stage that closes it
    note: str = ""
    risks: tuple[str, ...] = field(default=())


def gap(surfaces: tuple[str, ...], stage: str, note: str = "") -> Setting:
    return Setting("gap", surfaces, (), stage, note)


def server(surfaces: tuple[str, ...], *proofs: str, stage: str = "S6", note: str = "") -> Setting:
    return Setting("server", surfaces, tuple(proofs), stage, note)


FIELD: dict[str, Setting] = {
    "key": gap(
        (FORM, LIST, API, IMPORT),
        "S1",
        "key is read-only once published; nothing proves a new key reaches the screens",
    ),
    "label": Setting(
        "live",
        (FORM, LIST),
        ("e2e:s1-fields-grid.spec.ts::a label renamed in Studio shows on the live form and list",),
        "S1",
        "form and list header proven; import mapping, export headers, charts and search results not yet",
    ),
    "type": gap((FORM, LIST, INLINE, IMPORT, BULK), "S2"),
    "required": Setting(
        "live",
        (FORM, INLINE, IMPORT, BULK, API),
        (
            "e2e:s0-live-effect.spec.ts::a field made required in Studio is required on the live form",
            "e2e:s1-fields-grid.spec.ts::S1.3 required switch",
            "api:test_inline_edit.py::test_one_cell_change_clears_validates_and_refuses_stale_versions",
            "api:test_studio.py::test_field_cannot_become_required_while_records_lack_it",
        ),
        "S1",
        "form proven end to end; import, bulk and inline are proven on the server only",
    ),
    "group": gap((FORM,), "S1", "field group heading on the record form"),
    "normalize": gap((IMPORT, API, FORM), "S2", "decides how values are compared and saved"),
    "unique": Setting(
        "live",
        (FORM, IMPORT, API, BULK),
        (
            "e2e:s4-features.spec.ts::S4.3 Unique: duplicates block the publish and are listed; then a second user cannot save a duplicate",
            "api:test_field_switches.py::test_unique_is_blocked_while_records_hold_duplicates_then_holds_everywhere",
            "api:test_field_switches.py::test_switching_unique_off_allows_duplicates_again",
        ),
    ),
    "default": server(
        (FORM, IMPORT, API),
        "api:test_transforms.py::test_a_default_can_be_set_in_studio_and_old_defaults_still_apply",
        stage="S6",
        note="applies on create when blank; the S6 migration moves it into an 'if blank' rule",
    ),
    "transforms": Setting(
        "live",
        (FORM, IMPORT, API, BULK, INLINE),
        (
            "e2e:s5-transforms.spec.ts::S5.2 the Transformation rules panel",
            "e2e:s5-transforms.spec.ts::S5.4 Studio to live",
            "api:test_transforms.py::test_if_blank_sets_a_value_and_stops_and_an_update_without_the_field_leaves_it",
            "api:test_transforms.py::test_every_condition_and_keep_the_match_hold_on_create_inline_bulk_and_api",
            "api:test_transforms.py::test_every_action_on_a_text_field",
            "api:test_transforms.py::test_import_applies_the_rules_and_the_file_is_not_changed",
        ),
    ),
    "options": server(
        (FORM, LIST, IMPORT, BULK),
        "api:test_studio.py::test_removing_a_choice_in_use_is_refused_and_deleting_a_field_cleans_settings",
        stage="S1",
    ),
    "min": server(
        (FORM, IMPORT, API, INLINE, BULK),
        "api:live_effects/test_live_effects_audit.py::test_a_minimum_set_in_studio_stops_smaller_decimals",
        stage="S2",
        note="Studio sets it; whole numbers and decimals both obey it",
    ),
    "max": server(
        (FORM, IMPORT, API, INLINE, BULK),
        "api:live_effects/test_live_effects_audit.py::test_a_maximum_set_in_studio_stops_larger_decimals",
        stage="S2",
        note="Studio sets it; whole numbers and decimals both obey it",
    ),
    "max_length": server(
        (FORM, IMPORT, API, INLINE, BULK),
        "api:live_effects/test_live_effects_audit.py::test_a_length_set_in_studio_stops_longer_text_after_publish",
        "api:live_effects/test_live_effects_audit.py::test_a_length_set_in_studio_stops_longer_web_addresses_too",
        stage="S2",
        note="Studio sets it (Length column arrives in S2.4); text, email, phone and web address all obey it",
    ),
    "type_name": Setting(
        "live",
        (),
        (
            "e2e:s1-fields-grid.spec.ts::S2.7 the grid and the field panel show the same real-world type name",
        ),
        "S2",
        "the real-world type name; the grid and the field panel show the same name",
    ),
    "save_as": server(
        (FORM, IMPORT, API, INLINE, BULK),
        "api:live_effects/test_live_effects_audit.py::test_a_pan_type_chosen_in_studio_saves_capitals_and_stops_longer_values_after_publish",
        stage="S2",
        note="Set by choosing a type such as PAN (India); S5 turns it into transformation rules",
    ),
    "rules": server(
        (FORM, IMPORT, API, INLINE, BULK),
        "api:test_studio.py::test_a_rule_added_in_studio_stops_bad_values_on_the_api_after_publish_and_can_be_switched_off",
        "api:test_studio.py::test_rule_order_decides_which_message_is_shown",
        "api:test_studio.py::test_every_library_rule_accepts_its_good_samples_and_refuses_its_bad_ones",
        stage="S3",
        note="one engine (validate_record) serves create, update, bulk, import and duplicate merge; the popover arrives in S3.3",
    ),
    "analytics": gap((STATS,), "S6", "marks a field for the insights database"),
    "source": gap((), "S1", "stored marker; the redesign stops reading it"),
    "ref_table": server(
        (FORM, LIST, IMPORT),
        "api:test_relationships.py::test_a_link_can_be_relabelled_but_not_pointed_elsewhere",
        stage="S1",
    ),
    "hidden": server(
        (FORM, LIST, EXPORT, SEARCH, STATS),
        "api:test_export_import.py::test_a_hidden_field_never_leaves_in_an_export",
        "api:test_stats.py::test_a_hidden_number_is_never_summarised",
        "api:test_search.py::test_facets_count_and_narrow_and_respect_hidden_fields",
        stage="S1",
    ),
    "searchable": Setting(
        "live",
        (SEARCH,),
        (
            "e2e:s4-features.spec.ts::S4.4 Searchable: a record saved before the switch is found after publish; switching off hides it again",
            "api:test_field_switches.py::test_searchable_rebuilds_the_search_text_of_records_saved_before",
        ),
    ),
    "filterable": server(
        (LIST, SEARCH),
        "api:test_field_grid.py::test_filtering_can_be_off_while_sorting_stays_on",
        "api:test_field_switches.py::test_filterable_sets_the_field_flag_and_the_table_list_together",
        stage="S6",
        note="the tick sets field.filterable and the table's unfilterable list together",
    ),
    "help": gap((FORM,), "S1", "help text under the input"),
    "aliases": gap((IMPORT,), "S6", "kept working; editor moves to the import wizard later"),
}

TABLE: dict[str, Setting] = {
    "sort_filter": server(
        (LIST, API),
        "api:test_sort_filter.py::test_switching_sort_and_filter_off_refuses_the_new_filters",
        stage="S4",
    ),
    "sortable": server(
        (LIST, API),
        "api:test_studio.py::test_switches_for_sorting_and_filtering_hold_in_the_api_and_charts_take_dates_added",
        stage="S4",
    ),
    "filterable": server(
        (LIST, API),
        "api:test_field_grid.py::test_filtering_can_be_off_while_sorting_stays_on",
        stage="S4",
    ),
    "unsortable": server(
        (LIST, API),
        "api:test_sort_filter.py::test_per_field_settings_and_default_sort_are_checked",
        stage="S4",
    ),
    "unfilterable": server(
        (LIST, API),
        "api:test_sort_filter.py::test_per_field_settings_and_default_sort_are_checked",
        stage="S4",
    ),
    "default_sort": server(
        (LIST,),
        "api:test_sort_filter.py::test_per_field_settings_and_default_sort_are_checked",
        stage="S4",
    ),
    "select_bulk": server(
        (BULK,), "api:test_bulk.py::test_switches_are_enforced_on_the_server", stage="S4"
    ),
    "bulk_actions": server(
        (BULK,), "api:test_bulk.py::test_switches_are_enforced_on_the_server", stage="S4"
    ),
    "bulk_scope": gap((BULK,), "S4", "view versus every field"),
    "import_data": server(
        (IMPORT,),
        "api:test_export_import.py::test_json_files_import_and_the_switch_can_refuse_it",
        stage="S4",
    ),
    "export_data": server(
        (EXPORT,), "api:test_export_import.py::test_switches_and_formats_are_enforced", stage="S4"
    ),
    "export_formats": server(
        (EXPORT,), "api:test_export_import.py::test_switches_and_formats_are_enforced", stage="S4"
    ),
    "export_email": gap((EXPORT,), "S4", "emailed link switch"),
    "inline_edit": gap(
        (INLINE,), "S4", "table-wide switch; per-field list is proven, the switch itself is not"
    ),
    "grouping": gap((LIST,), "S4", "Group rows switch"),
    "statistics": server(
        (STATS, CHART),
        "api:test_stats.py::test_chosen_fields_are_checked_and_the_switch_is_enforced",
        "api:test_chart.py::test_chart_is_available_unless_numbers_are_switched_off",
        stage="S4",
    ),
    "stat_fields": server(
        (STATS,),
        "api:test_stats.py::test_chosen_fields_are_checked_and_the_switch_is_enforced",
        stage="S4",
    ),
    "stat_cards": server(
        (STATS,),
        "api:test_stat_cards.py::test_chosen_cards_are_computed_over_the_matches",
        stage="S4",
    ),
    "stat_scope": server(
        (STATS,), "api:test_stat_cards.py::test_whole_table_numbers_ignore_the_search", stage="S4"
    ),
    "stat_view": gap((STATS, CHART), "S4", "cards or chart above the table"),
    "chart": server(
        (CHART,), "api:test_chart.py::test_chart_settings_must_fit_the_table", stage="S4"
    ),
    "nochart": server(
        (CHART,), "api:test_chart.py::test_it_refuses_what_cannot_be_charted", stage="S4"
    ),
    "default_columns": gap((LIST,), "S4", "columns everyone sees first"),
    "density": gap((LIST,), "S4", "starting row height"),
    "uneditable": gap((INLINE,), "S4", "per-field edit in the list"),
    "ungroupable": gap((LIST,), "S4"),
    "unexported": server(
        (EXPORT,),
        "api:test_field_grid.py::test_a_field_left_out_of_exports_never_leaves",
        stage="S4",
    ),
    "nobulk": server(
        (BULK,),
        "api:test_field_grid.py::test_a_field_left_out_of_bulk_change_is_refused_by_the_server",
        stage="S4",
    ),
    "row_order": server(
        (LIST,), "api:test_row_order.py::test_switch_permission_and_scope_are_enforced", stage="S4"
    ),
}
