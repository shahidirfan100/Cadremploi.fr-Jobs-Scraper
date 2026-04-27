# API Discovery Report - Cadremploi.fr

## Phase 1 Audit Summary

Existing actor fields (before detail enrichment):

- id
- title
- url
- snippet
- contract
- location
- salary
- published_at
- company_name
- company_type
- company_logo
- apply_type
- has_already_applied
- offer_badges
- recruiter_badges
- search_type
- search_id
- total_results
- source_page

Missing high-value fields identified:

- description_text
- description_html
- published_date (exact)
- expires_at
- apply_url
- company_description
- city / postal_code / region / country
- salary_min / salary_max / salary_currency
- functions / industries taxonomy labels
- occupation classification

## URLScan + Bundle + Browser Discovery

### Candidate A (list API)

- Endpoint: https://www.cadremploi.fr/nouveau/api/emploi/offers
- Method: POST
- Auth: browser session cookies required
- Purpose: paginated listing cards
- Strength: pagination + list metadata (searchType, searchId, total)
- Weakness: no full description fields

### Candidate B (detail API) **SELECTED FOR DESCRIPTION FIELDS**

- Endpoint: https://www.cadremploi.fr/api/emploi/offer?offreId=<ID>
- Method: GET
- Auth: browser session cookies required (same-origin fetch from loaded page)
- Purpose: full offer detail payload
- Response top-level keys: offer, seo
- Rich fields in offer:
  - poste.description
  - profil.description
  - datePublication
  - dateExpiration
  - entreprise.description
  - remuneration.salaireMin / salaireMax / monnaie
  - contrat.typeContrat
  - postuler.url / postuler.canal
  - fonctions[] / secteurs[]
  - occupationClassification

### Candidate C (tracking API)

- Endpoint: https://www.cadremploi.fr/emploi/api/detail_offre_tracking/<ID>
- Method: GET
- Rejected: tracking-only endpoint, not content-rich for dataset.

## Required Headers / Request Context

Both selected APIs are called from browser context after opening a Cadremploi listing/detail page.

Working headers observed for detail API:

- Accept: application/json, text/plain, */*
- X-Requested-With: XMLHttpRequest
- Credentials: include (cookies)

Session requirement:

- A browser session must exist; direct unauthenticated server-side HTTP often fails due to anti-bot controls.
- Actor uses Playwright Firefox to establish cookies, then calls APIs with fetch from page context.

## Selection Score

### /nouveau/api/emploi/offers

- Returns JSON directly: +30
- >15 fields: +25
- No user login auth: +20
- Pagination support: +15
- Extends existing fields: +10
- Total: 100

### /api/emploi/offer

- Returns JSON directly: +30
- >15 fields: +25
- No user login auth: +20
- Pagination support: +0
- Extends existing fields: +10
- Total: 85

## Final Strategy

Use both endpoints together:

1. POST /nouveau/api/emploi/offers for paginated list retrieval.
2. For each unique offer id, GET /api/emploi/offer?offreId=<ID> for rich detail fields.
3. Merge list + detail records.
4. Remove null/empty values and skip duplicates by offer id.
