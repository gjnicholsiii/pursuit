"""Federal opportunity adapter skeleton.

Production implementation will use SAM.gov's public opportunities API. Pagination,
rate limits, retries, persistence and document acquisition belong in the worker runtime.
"""
from __future__ import annotations
from services.ingestion.connector_base import Connector, ConnectorResult

class SamGovConnector(Connector):
    key = "sam_gov"

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def discover(self) -> ConnectorResult:
        # Production implementation:
        # 1. Request opportunities updated since the previous cursor.
        # 2. Normalize notices into RawOpportunity.
        # 3. Preserve the complete raw notice for evidence/audit.
        # 4. Queue original attachment acquisition separately.
        return ConnectorResult(opportunities=[], diagnostics={"adapter": self.key, "status": "skeleton"})
