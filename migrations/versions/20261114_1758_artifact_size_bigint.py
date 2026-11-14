"""Widen artifacts.file_size_bytes to BIGINT.

A 3 GB trajectory overflowed the 32-bit INTEGER column, so ingestion failed at
commit time for every file above 2 GiB - while the bytes had already been
uploaded to the cold tier, leaving orphans.

Revision ID: b1c7f0d2a004
Revises: 4eebdd56515e
Create Date: 2026-11-14
"""

from alembic import op
import sqlalchemy as sa

revision = "b1c7f0d2a004"
down_revision = "4eebdd56515e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "artifacts",
        "file_size_bytes",
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "artifacts",
        "file_size_bytes",
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
