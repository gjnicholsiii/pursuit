"""SAM.gov public Contract Opportunities adapter.

This connector uses the public v2 search endpoint and preserves the full source record
inside RawOpportunity.metadata so later normalization never destroys provenance.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from services.ingestion.connector_base import Connector, ConnectorResult, RawOpportunity


class SamGovConnector(Connector):
    key = "sam_gov"
    endpoint = "https://api.sam.gov/opportunities/v2/search"

    def __init__(
        self,
        api_key: str,
        *,
        days_back: int = 2,
        page_size: int = 100,
        max_pages: int = 10,
        procurement_types: tuple[str, ...] = ("o", "k", "p", "r"),
    ):
        if not api_key:
            raise ValueError("SAM_GOV_API_KEY is required")
        self.api_key = api_key
        self.days_back = max(1, min(days_back, 365))
        self.page_size = max(1, min(page_size, 1000))
        self.max_pages = max(1, max_pages)
        self.procurement_types = procurement_types

    async def discover(self) -> ConnectorResult:
        posted_to = datetime.now(timezone.utc).date()
        posted_from = posted_to - timedelta(days=self.days_back)

        opportunities: list[RawOpportunity] = []
        offset = 0
        total_records = 0
        pages = 0

        while pages < self.max_pages:
            payload = await asyncio.to_thread(
                self._request_page,
                posted_from.strftime("%m/%d/%Y"),
                posted_to.strftime("%m/%d/%Y"),
                offset,
            )
            pages += 1
            total_records = int(payload.get("totalRecords") or 0)
            records = payload.get("opportunitiesData") or []

            for record in records:
                if record.get("active") == "No":
                    continue
                opportunities.append(self._normalize(record))

            if not records or offset + len(records) >= total_records:
                break
            offset += len(records)

        return ConnectorResult(
            opportunities=opportunities,
            diagnostics={
                "adapter": self.key,
                "endpoint": self.endpoint,
                "posted_from": posted_from.isoformat(),
                "posted_to": posted_to.isoformat(),
                "pages": pages,
                "api_total_records": total_records,
                "normalized_records": len(opportunities),
            },
        )

    def _request_page(self, posted_from: str, posted_to: str, offset: int) -> dict[str, Any]:
        params: list[tuple[str, str | int]] = [
            ("api_key", self.api_key),
            ("postedFrom", posted_from),
            ("postedTo", posted_to),
            ("limit", self.page_size),
            ("offset", offset),
        ]
        params.extend(("ptype", ptype) for ptype in self.procurement_types)
        url = f"{self.endpoint}?{urlencode(params, doseq=True)}"
        request = Request(url, headers={"Accept": "application/json", "User-Agent": "Pursuit/0.1"})
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    def _normalize(self, record: dict[str, Any]) -> RawOpportunity:
        place = record.get("placeOfPerformance") or {}
        state = place.get("state") or {}
        links = record.get("links") or []
        fallback_link = next((item.get("href") for item in links if item.get("href")), None)
        ui_link = record.get("uiLink")
        source_url = ui_link if ui_link and ui_link != "null" else fallback_link or self.endpoint

        agency_name = (
            record.get("fullParentPathName")
            or record.get("department")
            or record.get("subTier")
            or record.get("office")
            or "Unknown federal agency"
        )

        metadata = {
            "solicitation_number": record.get("solicitationNumber"),
            "notice_type": record.get("type"),
            "base_type": record.get("baseType"),
            "set_aside": record.get("typeOfSetAside"),
            "set_aside_description": record.get("typeOfSetAsideDescription"),
            "naics_code": record.get("naicsCode"),
            "classification_code": record.get("classificationCode"),
            "resource_links": record.get("resourceLinks") or [],
            "point_of_contact": record.get("pointOfContact"),
            "raw": record,
        }

        return RawOpportunity(
            source_external_id=str(record.get("noticeId") or record.get("solicitationNumber") or ""),
            title=(record.get("title") or "Untitled federal opportunity").strip(),
            source_url=source_url,
            agency_name=agency_name,
            state_code=state.get("code") or (record.get("officeAddress") or {}).get("state"),
            description=record.get("description"),
            issue_date=self._parse_datetime(record.get("postedDate")),
            due_at=self._parse_datetime(record.get("responseDeadLine")),
            metadata=metadata,
        )

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if not value or value == "null":
            return None
        text = str(value).strip().replace("Z", "+00:00")
        for parser in (
            lambda: datetime.fromisoformat(text),
            lambda: datetime.strptime(text, "%Y-%m-%d"),
            lambda: datetime.strptime(text, "%m/%d/%Y"),
        ):
            try:
                dt = parser()
                return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        return None
