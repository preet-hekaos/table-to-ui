"""records: the runtime may delete record rows (an import's undo); history keeps every deleted value

Revision ID: 0005
"""

from alembic import op

revision = "0005"
down_revision = "0004"

SQL = """
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.table_schema, t.table_name FROM information_schema.tables t
    JOIN control.tenant n ON n.schema_name = t.table_schema
    WHERE t.table_type = 'BASE TABLE'
      AND t.table_name NOT IN ('metadata_object','record_history','outbox','idempotency_key','schema_migration')
  LOOP
    EXECUTE format('GRANT DELETE ON %I.%I TO tableui_runtime', r.table_schema, r.table_name);
  END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(SQL)


def downgrade() -> None:
    raise NotImplementedError("forward-only")
