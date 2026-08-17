"""Generic contract for SLED procurement platform families.

Concrete adapters implement discovery for reusable platform families such as OpenGov,
PlanetBids, Euna-family portals or Public Purchase. Agency-specific configuration lives
in the source registry while parsing logic stays centralized.
"""
from __future__ import annotations
from dataclasses import dataclass
from services.ingestion.connector_base import Connector, ConnectorResult

@dataclass
class PortalConfig:
    portal_name: str
    agency_slug: str
    base_url: str
    state_code: str | None = None

class PortalFamilyConnector(Connector):
    key = "portal_family"

    def __init__(self, config: PortalConfig):
        self.config = config

    async def discover(self) -> ConnectorResult:
        return ConnectorResult(
            opportunities=[],
            diagnostics={
                "adapter": self.key,
                "portal": self.config.portal_name,
                "agency": self.config.agency_slug,
                "status": "skeleton",
            },
        )
