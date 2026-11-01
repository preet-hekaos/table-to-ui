"""Checks on a measure against its table. Shared by the pack loader and the Studio's measure builder."""

from tableui.metadata.domain.models import MeasureDef, TableDef

NUMERIC = {"integer", "decimal", "money", "months"}
NEEDS_VALUE = {"eq", "neq", "gt", "gte", "lt", "lte", "in"}


def problems(m: MeasureDef, table: TableDef) -> list[tuple[str, str]]:
    """(field, plain-words message) for everything wrong with a measure."""
    out: list[tuple[str, str]] = []

    def known(key: str | None, path: str, label: str) -> None:
        if key is None:
            return
        f = table.field(key)
        if f is None:
            out.append((path, f"{table.label} has no field '{key}'."))
        elif not f.analytics:
            out.append((path, f"'{f.label}' is not switched on for Insights ({label})."))

    if m.aggregate == "ratio":
        if len(m.ratio_of) != 2:
            out.append(("ratio_of", "A ratio needs exactly two measures: the top and the bottom."))
        return out
    if m.aggregate == "avg_days":
        if not (m.field and m.from_field):
            out.append(("field", "Average days needs a start date and an end date."))
        known(m.field, "field", "measured")
        if m.from_field != "created_at":
            known(m.from_field, "from_field", "measured")
        return out
    if m.aggregate in ("sum", "avg", "distinct") and not m.field:
        out.append(("field", "Pick the field to total, average or count."))
    if m.aggregate in ("sum", "avg") and m.field:
        f = table.field(m.field)
        if f is not None and f.type not in NUMERIC:
            out.append(
                ("field", f"'{f.label}' is not a number, so it cannot be totalled or averaged.")
            )
    if m.aggregate == "count" and m.field:
        out.append(("field", "Counting records does not need a field."))
    known(m.field, "field", "measured")
    if m.group_by:
        known(m.group_by, "group_by", "grouped")
        g = table.field(m.group_by)
        if g is not None and g.type not in ("select", "boolean"):
            out.append(
                ("group_by", f"'{g.label}' is not a choice field, so it cannot be used for bars.")
            )
    if m.time_field and m.time_field != "created_at":
        known(m.time_field, "time_field", "dated")
        t = table.field(m.time_field)
        if t is not None and t.type != "date":
            out.append(("time_field", f"'{t.label}' is not a date field."))
    if m.by_time and not m.time_field:
        out.append(("time_field", "A trend needs a date to follow."))
    if m.group_by and m.by_time:
        out.append(("group_by", "Choose bars by a field or a trend over time, not both."))
    if m.display == "trend" and not m.by_time:
        out.append(("display", "A trend needs 'per day', 'per week' or 'per month'."))
    if m.display == "bars" and not m.group_by:
        out.append(("display", "Bars need a field to group by."))
    if m.display == "number" and (m.group_by or m.by_time):
        out.append(("display", "Show this as bars or a trend, or remove the grouping."))
    for i, flt in enumerate(m.where):
        known(flt.field, f"where.{i}.field", "filtered")
        f = table.field(flt.field)
        if flt.op in NEEDS_VALUE and flt.value is None:
            out.append((f"where.{i}.value", "This filter needs a value."))
        if (
            flt.op in ("gt", "gte", "lt", "lte")
            and f is not None
            and f.type not in NUMERIC | {"date"}
        ):
            out.append((f"where.{i}.op", f"'{f.label}' cannot be compared as bigger or smaller."))
    return out
