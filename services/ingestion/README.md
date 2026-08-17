# Ingestion service

The ingestion service is the core operating asset of Pursuit.

## Principle

Buy or license breadth where that accelerates launch, then verify critical opportunity facts against original government sources and bid packages. Build reusable connectors by procurement-system family rather than one scraper per agency.

## Pipeline

1. Source registry selects connectors due for refresh.
2. Connector discovers new and changed solicitation records.
3. Raw records are stored before transformation.
4. Normalizer maps source-specific language into canonical opportunity fields.
5. Deduplication merges syndicated copies without destroying provenance.
6. Document workers acquire original solicitation documents, forms, spreadsheets and addenda.
7. Package-completeness workers detect referenced-but-missing documents.
8. Extraction converts documents into structured facts and requirements with evidence locators.
9. Contradiction detection compares facts across documents and amendments.
10. Readiness/eligibility evaluates company credentials against stated requirements.
11. Confidence scoring measures information completeness and reliability.
12. Source-health workers continuously verify collection.

## Initial source families

- SAM.gov federal opportunities API
- Licensed SLED breadth feed, subject to commercial terms
- Statewide procurement systems
- OpenGov procurement portals
- Euna-family portals where public interfaces and terms permit
- PlanetBids
- Public Purchase
- Independent government bid pages and document indexes

Every connector must preserve source URLs, timestamps and raw payloads for auditability.
