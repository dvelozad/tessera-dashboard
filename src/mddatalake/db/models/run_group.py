"""A named sub-division of a project: a campaign or study."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mddatalake.db.base import Base


class RunGroup(Base):
    """Campaign - the runs that share a scientific intent within a project.

    Tags answer 'where else does this run appear'; a campaign answers 'what is
    this set of runs for'. A run belongs to at most one campaign.
    """

    __tablename__ = "run_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(20))
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    project: Mapped["Project"] = relationship("Project", back_populates="run_groups")
    runs: Mapped[list["SimulationRun"]] = relationship(
        "SimulationRun", back_populates="group"
    )
