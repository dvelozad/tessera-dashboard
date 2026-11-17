"""Add campaigns (run groups) and attach runs to them.

Revision ID: d3f9a2c4b006
Revises: c2d8e1b3a005
Create Date: 2026-11-17
"""

from alembic import op
import sqlalchemy as sa

revision = "d3f9a2c4b006"
down_revision = "c2d8e1b3a005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "run_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_run_groups_project_id", "run_groups", ["project_id"])

    op.add_column("simulation_runs", sa.Column("group_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_simulation_runs_group_id",
        "simulation_runs",
        "run_groups",
        ["group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_simulation_runs_group_id", "simulation_runs", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_simulation_runs_group_id", table_name="simulation_runs")
    op.drop_constraint("fk_simulation_runs_group_id", "simulation_runs", type_="foreignkey")
    op.drop_column("simulation_runs", "group_id")
    op.drop_index("ix_run_groups_project_id", table_name="run_groups")
    op.drop_table("run_groups")
