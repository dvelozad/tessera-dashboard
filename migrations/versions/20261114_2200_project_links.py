"""Add project_links (repositories, datasets, manuscripts).

Revision ID: c2d8e1b3a005
Revises: b1c7f0d2a004
Create Date: 2026-11-14
"""

from alembic import op
import sqlalchemy as sa

revision = "c2d8e1b3a005"
down_revision = "b1c7f0d2a004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("link_type", sa.String(50), nullable=False, server_default="url"),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_project_links_project_id", "project_links", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_links_project_id", table_name="project_links")
    op.drop_table("project_links")
