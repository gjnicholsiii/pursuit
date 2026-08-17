# Pursuit

**Government revenue intelligence for small and midsize businesses.**

Pursuit is being built for companies that are registered, capable, and interested in government work but do not have a large government-contracting team.

## Product thesis

Bid aggregators answer: **What is government buying?**

Pursuit must answer the questions that determine whether a company can intelligently decide what to do next:

- Am I eligible to compete?
- How is this agency buying?
- What does this solicitation actually require?
- What is missing or contradictory?
- How confident is the information shown?
- What changed after I started watching it?

Pursuit never makes the pursue/walk decision for the customer. It presents evidence, readiness, procurement path, requirements, and confidence. The customer decides **Pursue / Watch / Walk**.

## MVP pillars

1. **Ready for Government** — SAM/UEI/CAGE/NAICS/certifications/vehicles and opportunity eligibility.
2. **Path to Award** — plain-language explanation of the procurement mechanism for the actual opportunity.
3. **Five-Minute Brief** — decisive facts extracted from the complete bid package.
4. **Confidence with receipts** — every critical fact tied to source evidence; missing data lowers confidence and explains why.
5. **Complete Package Watch** — monitor amendments, Q&A, deadlines and replaced attachments and explain what changed.

## Coverage

Federal + SLED: state, county, municipal, K-12, higher education, authorities and other public entities.

## Current state

The production app is deployed on Vercel, the core schema is live in Neon Postgres, and the app is wired to use `DATABASE_URL`. Federal opportunity ingestion is wired for `SAM_GOV_API_KEY`.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.
