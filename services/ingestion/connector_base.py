from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

@dataclass
class RawOpportunity:
    source_external_id: str
    title: str
    source_url: str
    agency_name: str
    state_code: str | None = None
    description: str | None = None
    issue_date: datetime | None = None
    due_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

@dataclass
class ConnectorResult:
    opportunities: list[RawOpportunity]
    diagnostics: dict[str, Any] = field(default_factory=dict)

class Connector(ABC):
    """One adapter per procurement-system family, not one scraper per agency."""

    key: str

    @abstractmethod
    async def discover(self) -> ConnectorResult:
        raise NotImplementedError

    async def fetch_documents(self, opportunity: RawOpportunity) -> Iterable[dict[str, Any]]:
        return []

    async def healthcheck(self) -> dict[str, Any]:
        started = datetime.utcnow()
        try:
            result = await self.discover()
            return {
                "ok": True,
                "checked_at": started.isoformat(),
                "records_seen": len(result.opportunities),
                "diagnostics": result.diagnostics,
            }
        except Exception as exc:
            return {
                "ok": False,
                "checked_at": started.isoformat(),
                "error": repr(exc),
            }
