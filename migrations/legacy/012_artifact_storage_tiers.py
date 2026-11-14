"""Track artifact storage tiers (hot cache / Google Drive cold tier).

Revision ID: 012
Revises: 011
Create Date: 2026-11-14
"""

from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "artifacts",
        sa.Column(
            "storage_state",
            sa.String(20),
            nullable=False,
            server_default="stored",
        ),
    )
    op.create_index(
        "ix_artifacts_storage_state", "artifacts", ["storage_state"], unique=False
    )
    op.add_column("artifacts", sa.Column("remote_path", sa.String(1024), nullable=True))
    op.add_column(
        "artifacts", sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("artifacts", "last_verified_at")
    op.drop_column("artifacts", "remote_path")
    op.drop_index("ix_artifacts_storage_state", table_name="artifacts")
    op.drop_column("artifacts", "storage_state")
