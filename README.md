# Cadremploi.fr Jobs Scraper

Extract fresh job listings from Cadremploi.fr with flexible filters and clean, analysis-ready output. Collect key fields such as title, company, location, contract, salary, and offer URL for market research, recruiting intelligence, and job monitoring workflows.

## Features

- **Cadremploi job extraction** — Collect listings from Cadremploi.fr at scale
- **HTTP-only extraction path** — Uses Cadremploi APIs through got-scraping (no browser startup delay)
- **URL or keyword workflow** — Start from a listing URL or use keyword and location filters
- **Rich offer detail coverage** — Capture full descriptions, taxonomy fields, exact dates, and application URLs
- **Pagination controls** — Limit extraction with maximum pages and maximum results
- **Clean dataset output** — Empty/null/invalid scalar values are normalized for consistent records
- **Automation-ready output** — Data can be exported in JSON, CSV, Excel, XML, and consumed in integrations

## Use Cases

### Talent Market Research
Track active hiring demand by role, location, and contract type. Build recurring snapshots to compare market movement over time.

### Recruitment Intelligence
Monitor competitor hiring activity and identify recurring position profiles. Use structured data to support sourcing strategy and pipeline planning.

### Job Aggregation Pipelines
Feed listings into internal systems, dashboards, or search tools. Use consistent output fields to simplify downstream processing.

### Geo-Focused Opportunity Tracking
Collect roles for targeted cities or areas to analyze local opportunity concentration. Useful for relocation studies and regional job trend reporting.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | String | No | `"https://www.cadremploi.fr/emploi/liste_offres"` | Cadremploi listing URL (can include filters) |
| `keyword` | String | No | `"infirmier"` | Keyword filter that takes priority over URL keyword |
| `location` | String | No | `"Paris"` | Location text used to apply location filtering |
| `results_wanted` | Integer | No | `20` | Maximum number of jobs to save |
| `max_pages` | Integer | No | `10` | Maximum number of result pages to process |
| `proxyConfiguration` | Object | No | Disabled (`useApifyProxy: false`) | Optional proxy setup (enable only when needed) |

## Output Data

Each item in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Cadremploi offer ID |
| `title` | String | Job title |
| `url` | String | Absolute job offer URL |
| `snippet` | String | Short listing summary |
| `description_text` | String | Combined detailed offer description text |
| `description_html` | String | HTML-formatted detailed description |
| `contract` | String | Contract type |
| `contract_code` | Number | Contract code from source taxonomy |
| `work_type` | String | Work type label when available |
| `location` | String | Full job location label |
| `city` | String | City extracted from detail payload |
| `postal_code` | String | Postal code |
| `region` | String | Region label |
| `country` | String | Country code |
| `salary` | String | Salary summary from listing |
| `salary_min` | Number | Minimum salary |
| `salary_max` | Number | Maximum salary |
| `salary_currency` | String | Salary currency |
| `published_at` | String | Relative publication text |
| `published_date` | String | Exact publication date |
| `expires_at` | String | Offer expiration date |
| `company_name` | String | Company or recruiter name |
| `company_description` | String | Company description |
| `company_type` | String | Company type when available |
| `company_logo` | String | Company logo URL |
| `company_logo_large` | String | Large company logo URL |
| `apply_type` | String | Application channel |
| `apply_url` | String | Application destination URL |
| `is_external_offer` | Boolean | External source flag |
| `has_already_applied` | Boolean | Application state when available |
| `offer_badges` | Array | Offer badges shown on listing/detail |
| `recruiter_badges` | Array | Recruiter badges shown on listing/detail |
| `job_functions` | Array | Function labels linked to the offer |
| `job_function_codes` | Array | Function codes |
| `industries` | Array | Industry labels linked to the offer |
| `industry_codes` | Array | Industry codes |
| `experience_level` | String | Experience level label |
| `accepts_junior` | Boolean | Junior profile accepted flag |
| `occupation_classification_slug` | String | Occupation classification slug |
| `occupation_classification_label` | String | Occupation classification label |
| `status_by_date` | String | Offer status by date |
| `source` | String | Source identifier |
| `search_type` | String | Search mode metadata |
| `search_id` | String | Search identifier metadata |
| `total_results` | Number | Total results reported by source |
| `source_page` | Number | Source page index |

## Usage Examples

### Basic Run

```json
{
  "url": "https://www.cadremploi.fr/emploi/liste_offres",
  "results_wanted": 20
}
```

### Keyword and Location

```json
{
  "keyword": "data analyst",
  "location": "Lyon",
  "results_wanted": 50,
  "max_pages": 10
}
```

### Filtered URL Input

```json
{
  "url": "https://www.cadremploi.fr/emploi/liste_offres?dep=75&tyc=1",
  "results_wanted": 100,
  "max_pages": 20
}
```

## Sample Output

```json
{
  "id": "156535427459969552",
  "title": "Referent Qualite et Certifications H/F",
  "url": "https://www.cadremploi.fr/emploi/detail_offre?offreId=156535427459969552",
  "snippet": "Suite au depart d'un collaborateur experimente...",
  "description_text": "Faites le choix d'une entreprise en mouvement...",
  "description_html": "<p>Faites le choix d'une entreprise en mouvement...</p>",
  "contract": "CDI",
  "location": "Roissy-en-France",
  "city": "Roissy-en-France",
  "salary_min": 45000,
  "salary_max": 52000,
  "salary_currency": "EUR",
  "published_at": "Publiee il y a quelques minutes",
  "published_date": "2026-04-26T10:14:00+02:00",
  "company_name": "PLEIADE CONSULTING",
  "apply_url": "https://www.cadremploi.fr/...",
  "job_functions": ["Qualité", "Opérations"],
  "apply_type": "formulaire",
  "source_page": 1
}
```

## Tips for Best Results

### Prefer Real Cadremploi Listing URLs
Use valid listing pages from Cadremploi.fr to ensure robust extraction.

### Start Small, Then Scale
Begin with `results_wanted: 20` to validate filters, then increase limits for production runs.

### Use Location Text Carefully
Use clear city or area names (for example `Paris`, `Lyon`, `Marseille`) for more consistent location filtering.

### Keep Pagination Balanced
Set `max_pages` high enough for your goal, but avoid overly large values for fast operational runs.

### Proxy Configuration

Proxy is optional and disabled by default for speed. Enable it only when needed (for example if your network gets blocked):

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Integrations

Connect output to:

- **Google Sheets** — Build sortable hiring trackers
- **Airtable** — Create searchable recruitment datasets
- **Make** — Automate no-code workflows
- **Zapier** — Trigger alerts and follow-up actions
- **Webhooks** — Send data to custom services

### Export Formats

- **JSON** — API and engineering workflows
- **CSV** — Spreadsheet analytics
- **Excel** — Business reporting
- **XML** — System integration pipelines

## Frequently Asked Questions

### How many jobs can I collect?
You can collect as many as needed by increasing `results_wanted` and `max_pages`, within source availability.

### Which input has priority, URL or keyword/location?
User-provided keyword and location are prioritized when supplied. If not supplied, URL filters are used.

### Why are some fields missing in certain records?
Some listings do not expose every field from the source APIs. The actor applies fallbacks and normalization to avoid null/undefined values whenever possible.
