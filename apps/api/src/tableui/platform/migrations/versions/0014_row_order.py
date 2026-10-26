"""records: a shared hand-made order per table (sort_order), added to every existing record table

Revision ID: 0014
"""

from alembic import op

revision = "0014"
down_revision = "0013"

SQL = """
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name FROM information_schema.columns c
    JOIN control.tenant n ON n.schema_name = c.table_schema
    WHERE c.column_name = 'search_doc'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS sort_order double precision', r.table_schema, r.table_name);
  END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(SQL)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
