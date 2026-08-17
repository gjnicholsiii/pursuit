# Pursuit architecture

## Product thesis

Pursuit is not another bid-search database. It is a government revenue intelligence system for small and midsize businesses that do not have a large government-contracting staff.

Pursuit does not decide whether a customer should bid. It makes the opportunity understandable, shows eligibility and procurement mechanics, preserves the evidence, and exposes missing or contradictory information. The customer decides Pursue / Watch / Walk.

## Systems

### 1. Collection plane
Federal APIs, licensed SLED breadth feeds, procurement-platform adapters, government site collectors and agency-specific fallbacks.

### 2. Evidence plane
Immutable raw notices, solicitation documents, spreadsheets, addenda, forms and award records. Every critical extracted fact points back to source evidence.

### 3. Canonical data plane
PostgreSQL stores companies, selling profiles, readiness credentials, agencies, opportunities, documents, requirements, procurement paths, eligibility results, confidence results, customer decisions and source-health telemetry.

### 4. Intelligence plane
- Ready for Government eligibility evaluation
- Path to Award procurement-mechanism explanation
- Five-Minute Brief extraction
- Package completeness detection
- Contradiction detection
- Confidence scoring with reasons
- Amendment/change summarization
- Customer-controlled Pursue / Watch / Walk decisions

### 5. Experience plane
Next.js application organized around Revenue Today, Opportunities, Ready for Government, Path to Award, Pipeline, Agencies, Contracts and Search.

## Confidence principle

Confidence is not a win probability and is not a recommendation. It measures how complete and reliable the information presented by Pursuit is for the opportunity.

Confidence should fall when:
- referenced documents are missing;
- solicitation sections contradict each other;
- critical facts cannot be located;
- source provenance is weak;
- an extraction is uncertain;
- an amendment may supersede an earlier requirement.

The UI must always explain why confidence is reduced and what could increase it.

## Non-negotiables

- Source provenance survives every transformation.
- Unknown stays unknown.
- No fabricated procurement facts.
- Exact-keyword retrieval remains alongside semantic retrieval.
- The customer owns the Pursue / Watch / Walk decision.
- Source failures are observable before customers discover missing opportunities.
- Long-running ingestion executes outside the web request lifecycle.
