import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { CookieJar } from 'tough-cookie';

const REG_ISO_TO_CODE = {
    'FR-J': '12',
    'FR-V': '22',
    'FR-U': '21',
    'FR-B': '2',
    'FR-R': '18',
    'FR-O': '17',
    'FR-E': '6',
    'FR-N': '16',
    'FR-K': '13',
    'FR-F': '7',
};

const DEFAULT_COMPANY_LOGO = 'https://www.cadremploi.fr/favicon.ico';

const toInt = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
};

const normalizeScalar = (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const lowered = trimmed.toLowerCase();
        if (lowered === 'undefined' || lowered === 'null' || lowered === 'nan') return undefined;
        return trimmed;
    }
    return value;
};

const parseListParam = (urlObj, key) => {
    const raw = urlObj.searchParams.getAll(key);
    if (!raw.length) return [];
    return raw
        .flatMap((v) => String(v).split(','))
        .map((v) => v.trim())
        .filter(Boolean);
};

const normalizeCitySlug = (value) => {
    const slug = String(value || '').trim().toLowerCase();
    if (!slug) return undefined;
    const shortMatch = slug.match(/^(.+-\d{2})\d{3}$/);
    return shortMatch ? shortMatch[1] : slug;
};

const decodeHtmlEntities = (value) => {
    if (!value) return undefined;
    return String(value)
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&#x([\da-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
};

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildDescriptionText = (...parts) => {
    const lines = parts
        .map((part) => decodeHtmlEntities(part))
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean);

    if (!lines.length) return undefined;
    return lines.join('\n\n');
};

const buildDescriptionHtml = (value) => {
    if (!value) return undefined;
    const text = decodeHtmlEntities(value)?.trim();
    if (!text) return undefined;

    if (/<[a-z][\s\S]*>/i.test(text)) return text;

    const paragraphs = text
        .split(/\n\n+/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
        .join('');

    return paragraphs || undefined;
};

const removeEmpty = (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return normalizeScalar(value);
    if (Array.isArray(value)) {
        const cleaned = value
            .map((v) => removeEmpty(v))
            .filter((v) => v !== undefined);
        return cleaned.length ? cleaned : undefined;
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const cleaned = removeEmpty(v);
            if (cleaned !== undefined) out[k] = cleaned;
        }
        return Object.keys(out).length ? out : undefined;
    }
    return value;
};

const isObjectWithKeys = (value) => (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length > 0
);

const loadSchemaFallbackInput = async () => {
    try {
        const raw = await readFile('.actor/input_schema.json', 'utf8');
        const schema = JSON.parse(raw);
        const properties = schema?.properties;
        if (!properties || typeof properties !== 'object') return {};

        const fromSchema = {};
        for (const [key, config] of Object.entries(properties)) {
            if (!config || typeof config !== 'object') continue;
            if (config.prefill !== undefined) {
                fromSchema[key] = config.prefill;
                continue;
            }
            if (config.default !== undefined) {
                fromSchema[key] = config.default;
            }
        }

        return isObjectWithKeys(fromSchema) ? fromSchema : {};
    } catch (err) {
        log.debug(`Could not read schema fallback input: ${err.message}`);
        return {};
    }
};

const loadInputJsonFallback = async () => {
    try {
        const raw = await readFile('INPUT.json', 'utf8');
        const parsed = JSON.parse(raw);
        return isObjectWithKeys(parsed) ? parsed : {};
    } catch (err) {
        log.debug(`Could not read INPUT.json fallback: ${err.message}`);
        return {};
    }
};

const resolveInput = async () => {
    const runtimeInput = (await Actor.getInput()) || {};
    if (isObjectWithKeys(runtimeInput)) {
        return runtimeInput;
    }

    const schemaFallback = await loadSchemaFallbackInput();
    if (isObjectWithKeys(schemaFallback)) {
        log.info('Actor input is empty. Using defaults from .actor/input_schema.json.');
        return schemaFallback;
    }

    const inputJsonFallback = await loadInputJsonFallback();
    if (isObjectWithKeys(inputJsonFallback)) {
        log.info('Actor input and schema defaults are empty. Using INPUT.json fallback.');
        return inputJsonFallback;
    }

    log.warning('No runtime input, schema defaults, or INPUT.json fallback found. Using empty input.');
    return {};
};

const extractStartUrl = (input) => {
    if (input.url) return String(input.url);
    if (input.startUrl) return String(input.startUrl);
    if (Array.isArray(input.startUrls) && input.startUrls.length) {
        const first = input.startUrls[0];
        if (typeof first === 'string') return first;
        if (first && typeof first.url === 'string') return first.url;
    }
    return 'https://www.cadremploi.fr/emploi/liste_offres';
};

const parseFiltersFromUrl = (startUrl) => {
    let parsed;
    try {
        parsed = new URL(startUrl, 'https://www.cadremploi.fr');
    } catch {
        parsed = new URL('https://www.cadremploi.fr/emploi/liste_offres');
    }

    const fromUrl = {
        startUrl: parsed.href,
        pathWithQuery: `${parsed.pathname}${parsed.search}`,
        keywords: parsed.searchParams.get('motscles') || undefined,
        query: parsed.searchParams.get('query') || undefined,
        cities: parseListParam(parsed, 'ville').map(normalizeCitySlug).filter(Boolean),
        departments: parseListParam(parsed, 'dep'),
        regionsRaw: parseListParam(parsed, 'reg'),
        contracts: parseListParam(parsed, 'tyc').map((v) => Number(v)).filter((v) => Number.isFinite(v)),
        categories: parseListParam(parsed, 'fct').map((v) => Number(v)).filter((v) => Number.isFinite(v)),
        industries: parseListParam(parsed, 'sct').map((v) => Number(v)).filter((v) => Number.isFinite(v)),
        companiesIds: parseListParam(parsed, 'entrepriseid'),
        recruiterType: parseListParam(parsed, 'companytype'),
        salaryMin: parsed.searchParams.get('salary') || undefined,
        section: parsed.searchParams.get('rub') || undefined,
        radius: parsed.searchParams.get('rayon') || undefined,
    };

    const mappedRegions = fromUrl.regionsRaw
        .map((r) => REG_ISO_TO_CODE[r] || (Number.isFinite(Number(r)) ? String(r) : undefined))
        .filter(Boolean);

    return {
        ...fromUrl,
        regions: mappedRegions,
    };
};

const resolveLocation = async (location) => {
    if (!location) return {};
    const query = encodeURIComponent(String(location).trim());
    if (!query) return {};

    const response = await gotScraping.get(`https://services.cadremploi.fr/services/suggestions/v1/locations/${query}`, {
        headers: {
            Accept: 'application/json',
        },
        headerGeneratorOptions: {
            browsers: [
                { name: 'chrome', minVersion: 100 },
                { name: 'firefox', minVersion: 100 },
            ],
            devices: ['desktop'],
            locales: ['fr-FR', 'fr'],
        },
        timeout: { request: 30000 },
    });

    const data = JSON.parse(response.body);
    const city = data?.cities?.[0];
    if (city) {
        return {
            cities: [normalizeCitySlug(city.slug)].filter(Boolean),
            departments: undefined,
            regions: undefined,
            latitude: city.geoCode?.latitude,
            longitude: city.geoCode?.longitude,
            radius: 20,
            location: city.city,
        };
    }

    const department = data?.departments?.[0];
    if (department) {
        return {
            cities: undefined,
            departments: [String(department.department?.code)].filter(Boolean),
            regions: undefined,
            latitude: undefined,
            longitude: undefined,
            radius: undefined,
            location: department.department?.label,
        };
    }

    const region = data?.regions?.[0];
    if (region) {
        return {
            cities: undefined,
            departments: undefined,
            regions: [String(region.region?.code)].filter(Boolean),
            latitude: undefined,
            longitude: undefined,
            radius: undefined,
            location: region.region?.label,
        };
    }

    return {};
};

const toAbsoluteOfferUrl = (url) => {
    if (!url) return undefined;
    try {
        return new URL(url, 'https://www.cadremploi.fr').href;
    } catch {
        return undefined;
    }
};

const normalizeLogoUrl = (value) => {
    const cleaned = normalizeScalar(value);
    if (!cleaned) return undefined;
    return cleaned.replace(/\s+/g, '');
};

const buildBaseRequestOptions = (ctx, headers = {}) => ({
    cookieJar: ctx.cookieJar,
    proxyUrl: ctx.proxyUrl,
    sessionToken: ctx.sessionToken,
    throwHttpErrors: false,
    timeout: { request: 30000 },
    retry: { limit: 2 },
    headerGeneratorOptions: {
        browsers: [
            { name: 'chrome', minVersion: 100 },
            { name: 'firefox', minVersion: 100 },
            { name: 'safari', minVersion: 15 },
        ],
        devices: ['desktop'],
        locales: ['fr-FR', 'fr'],
    },
    headers: {
        ...headers,
    },
});

const parseJsonSafe = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const createHttpSession = async ({ startUrl, proxyConfiguration }) => {
    const cookieJar = new CookieJar();
    const proxyUrl = proxyConfiguration
        ? await proxyConfiguration.newUrl('cadremploi_session')
        : undefined;

    const sessionToken = {};

    const session = {
        cookieJar,
        proxyUrl,
        sessionToken,
    };

    const startRes = await gotScraping.get(startUrl, buildBaseRequestOptions(session, {
        accept: 'text/html,application/xhtml+xml',
    }));

    if (startRes.statusCode >= 400) {
        throw new Error(`Failed to initialize session. Start page status: ${startRes.statusCode}`);
    }

    await gotScraping.post(
        'https://www.cadremploi.fr/emploi/sessionData/create_session',
        buildBaseRequestOptions(session, {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json',
            referer: startUrl,
            origin: 'https://www.cadremploi.fr',
        }),
    );

    return session;
};

const fetchOffersPage = async ({ session, payload, startUrl }) => {
    const res = await gotScraping.post(
        'https://www.cadremploi.fr/nouveau/api/emploi/offers',
        {
            ...buildBaseRequestOptions(session, {
                accept: 'application/json',
                'content-type': 'application/json',
                referer: startUrl,
                origin: 'https://www.cadremploi.fr',
            }),
            json: payload,
        },
    );

    return {
        status: res.statusCode,
        body: res.body,
        json: parseJsonSafe(res.body),
    };
};

const fetchOfferDetailsMap = async ({ session, offerIds, concurrency = 10 }) => {
    if (!offerIds.length) return new Map();

    const ids = [...offerIds];
    const detailsById = new Map();
    const workerCount = Math.max(1, Math.min(concurrency, ids.length));

    const worker = async () => {
        while (ids.length) {
            const offerId = ids.pop();
            if (!offerId) continue;

            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const detailRes = await gotScraping.get(
                        `https://www.cadremploi.fr/api/emploi/offer?offreId=${encodeURIComponent(offerId)}`,
                        buildBaseRequestOptions(session, {
                            accept: 'application/json, text/plain, */*',
                            referer: `https://www.cadremploi.fr/emploi/detail_offre?offreId=${offerId}`,
                            'x-requested-with': 'XMLHttpRequest',
                        }),
                    );

                    if (detailRes.statusCode !== 200) {
                        if (attempt === 2) {
                            log.debug(`Detail endpoint returned ${detailRes.statusCode} for ${offerId}`);
                        }
                        continue;
                    }

                    const detailJson = parseJsonSafe(detailRes.body);
                    if (detailJson?.offer) {
                        detailsById.set(offerId, detailJson.offer);
                    }
                    break;
                } catch (err) {
                    if (attempt === 2) {
                        log.debug(`Detail fetch failed for ${offerId}: ${err.message}`);
                    }
                }
            }
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return detailsById;
};

const inferLargeLogoFromSmall = (logo150) => {
    const small = normalizeLogoUrl(logo150);
    if (!small) return undefined;
    if (small.includes('/logo150')) return small.replace('/logo150', '/public');
    return undefined;
};

const inferSmallLogoFromLarge = (logoLarge) => {
    const large = normalizeLogoUrl(logoLarge);
    if (!large) return undefined;
    if (large.includes('/public')) return large.replace('/public', '/logo150');
    return undefined;
};

await Actor.init();

let exitCode = 0;
try {
    const input = await resolveInput();

    const {
        results_wanted = 20,
        max_pages = 10,
        keyword: keywordInput = '',
        location: locationInput = '',
    } = input;

    const parsed = parseFiltersFromUrl(extractStartUrl(input));

    const resultsWanted = toInt(results_wanted, 20);
    const maxPages = toInt(max_pages, 10);

    const keyword = typeof keywordInput === 'string' ? keywordInput.trim() : '';
    const location = typeof locationInput === 'string' ? locationInput.trim() : '';

    const locationFilter = location ? await resolveLocation(location) : {};

    // Use Apify proxy by default on the platform to avoid being blocked
    let proxyConfig = input.proxyConfiguration;
    if (!proxyConfig && Actor.isAtHome()) {
        proxyConfig = { useApifyProxy: true };
    }
    const proxyConfiguration = proxyConfig
        ? await Actor.createProxyConfiguration(proxyConfig)
        : undefined;

    const session = await createHttpSession({
        startUrl: parsed.startUrl,
        proxyConfiguration,
    });

    const seenOfferIds = new Set();
    const detailConcurrency = toInt(input.detail_concurrency, 12);
    let saved = 0;

    for (let pageNumber = 1; pageNumber <= maxPages && saved < resultsWanted; pageNumber++) {
        const payload = removeEmpty({
            page: pageNumber,
            sort: 'PERTINENCE',
            keywords: keyword || parsed.keywords,
            query: keyword || parsed.query,
            contracts: parsed.contracts,
            occupationalCategories: parsed.categories,
            industries: parsed.industries,
            regions: location ? locationFilter.regions : parsed.regions,
            departments: location ? locationFilter.departments : parsed.departments,
            cities: location ? locationFilter.cities : parsed.cities,
            latitude: locationFilter.latitude,
            longitude: locationFilter.longitude,
            radius: locationFilter.radius || toInt(parsed.radius, undefined),
            companiesIds: parsed.companiesIds,
            recruteurType: parsed.recruiterType,
            salaryMin: parsed.salaryMin,
            section: parsed.section,
            clear: false,
            location: locationFilter.location,
            listeRelativeUrl: parsed.pathWithQuery || '/emploi/liste_offres',
            withRanking: true,
            isSEO: true,
        });

        const response = await fetchOffersPage({
            session,
            payload,
            startUrl: parsed.startUrl,
        });

        if (response.status !== 200 || !response.json) {
            const errorMsg = `Offers API returned ${response.status}. Preview: ${String(response.body).slice(0, 300)}`;
            log.error(errorMsg);
            if (pageNumber === 1) {
                throw new Error(`Failed to fetch the first page of jobs: ${errorMsg}`);
            }
            break;
        }

        const offers = response.json.jobPostingsExpanded
            || response.json.jobPostings
            || [];

        if (!offers.length) {
            log.info(`No offers on page ${pageNumber}. Stopping.`);
            break;
        }

        const detailOfferIds = offers
            .map((offer) => String(offer?.id || ''))
            .filter((offerId) => offerId && !seenOfferIds.has(offerId));

        const detailsById = await fetchOfferDetailsMap({
            session,
            offerIds: detailOfferIds,
            concurrency: detailConcurrency,
        });

        const out = [];
        for (const offer of offers) {
            if (saved >= resultsWanted) break;

            const offerId = String(offer?.id || '');
            if (!offerId || seenOfferIds.has(offerId)) continue;
            seenOfferIds.add(offerId);

            const detail = detailsById.get(offerId) || {};
            const detailPoste = detail.poste || {};
            const detailProfil = detail.profil || {};
            const detailLocation = detailPoste.localisation || {};
            const detailContract = detail.contrat || {};
            const detailCompany = detail.entreprise || {};
            const detailApply = detail.postuler || {};
            const detailRemuneration = detail.remuneration || {};
            const detailBadges = detail.badges || {};

            const fallbackLocation = [
                detailLocation.ville,
                detailLocation.departement?.label,
                detailLocation.region,
            ].filter(Boolean).join(', ');

            const resolvedLocation = normalizeScalar(
                detailLocation.libelle
                || offer.location
                || fallbackLocation,
            );

            const resolvedCity = normalizeScalar(
                detailLocation.ville
                || offer.city
                || resolvedLocation
                || detailLocation.departement?.label
                || detailLocation.region
                || detailLocation.pays
                || offer.country
                || 'France',
            );

            const descriptionText = buildDescriptionText(
                detail.description_text,
                detailPoste.description,
                detailProfil.description,
                offer.snippet,
            );

            const descriptionHtml = buildDescriptionHtml(
                detail.description_html
                || detailPoste.description
                || descriptionText,
            );

            const detailFunctions = Array.isArray(detail.fonctions) ? detail.fonctions : [];
            const detailSectors = Array.isArray(detail.secteurs) ? detail.secteurs : [];
            const detailTravelZones = Array.isArray(detail.zonesDeplacement) ? detail.zonesDeplacement : [];

            const logo150 = normalizeLogoUrl(
                detailCompany.logo150
                || detailCompany.logo
                || offer.company?.logo,
            ) || inferSmallLogoFromLarge(detailCompany.logo400 || offer.company?.logoLarge);

            const logoLarge = normalizeLogoUrl(
                detailCompany.logo400
                || offer.company?.logoLarge,
            ) || inferLargeLogoFromSmall(logo150);

            const resolvedLogo = logo150 || logoLarge || DEFAULT_COMPANY_LOGO;
            const resolvedLogoLarge = logoLarge || logo150 || DEFAULT_COMPANY_LOGO;

            const cleaned = removeEmpty({
                id: offer.id,
                title: offer.title,
                url: toAbsoluteOfferUrl(offer.url),
                snippet: offer.snippet,
                description_text: descriptionText,
                description_html: descriptionHtml,
                contract: detailContract.typeContrat?.label || offer.contract,
                contract_code: detailContract.typeContrat?.code,
                work_type: detailContract.typeTravail?.label,
                location: resolvedLocation,
                city: resolvedCity,
                postal_code: detailLocation.codePostal || offer.postalCode,
                department_code: detailLocation.departement?.code || offer.departmentCode,
                department_label: detailLocation.departement?.label || offer.departmentLabel,
                region: detailLocation.region || offer.region,
                country: detailLocation.pays || offer.country,
                latitude: detailLocation.latitude,
                longitude: detailLocation.longitude,
                salary: offer.salary,
                salary_min: detailRemuneration.salaireMin,
                salary_max: detailRemuneration.salaireMax,
                salary_currency: detailRemuneration.monnaie || offer.salaryCurrency,
                salary_hidden: detailRemuneration.masquer,
                published_at: offer.date,
                published_date: detail.datePublication || offer.date,
                expires_at: detail.dateExpiration,
                company_name: detailCompany.raisonSociale || offer.company?.name,
                company_type: offer.company?.type,
                company_description: detailCompany.description || offer.company?.description,
                company_logo: resolvedLogo,
                company_logo_large: resolvedLogoLarge,
                apply_type: detailApply.canal || offer.apply?.type,
                apply_url: detailApply.url || offer.apply?.url || toAbsoluteOfferUrl(offer.url),
                is_external_offer: detail.source ? detail.source !== 'CADREMPLOI' : undefined,
                has_already_applied: offer.apply?.hasAlreadyAppliedToCurrentOffer,
                offer_badges: detailBadges.offerBadges || offer.offerBadges,
                recruiter_badges: detailBadges.enterpriseBadges || offer.recruiterBadge,
                job_functions: detailFunctions.map((fn) => fn.label).filter(Boolean),
                job_function_codes: detailFunctions.map((fn) => fn.code).filter((code) => Number.isFinite(Number(code))),
                industries: detailSectors.map((sector) => sector.label).filter(Boolean),
                industry_codes: detailSectors.map((sector) => sector.code).filter((code) => Number.isFinite(Number(code))),
                experience_level: detailProfil.libelleNiveauExperience,
                accepts_junior: detailProfil.isJeuneDiplomeAccepte,
                zones_deplacement: detailTravelZones,
                occupation_classification_slug: detail.occupationClassification?.slug,
                occupation_classification_label: detail.occupationClassification?.label,
                status_by_date: detail.statusByDate,
                source: detail.source || offer.source,
                search_type: response.json.searchType,
                search_id: response.json.searchId,
                total_results: response.json.total,
                source_page: pageNumber,
            });

            if (cleaned) {
                out.push(cleaned);
                saved++;
            }
        }

        if (out.length) {
            await Dataset.pushData(out);
            log.info(`Saved ${out.length} jobs from page ${pageNumber}. Total saved: ${saved}/${resultsWanted}`);
        }

        const pageLimit = response.json.limit ?? offers.length;
        if (offers.length < pageLimit) break;
    }

    log.info(`Extraction complete. Total saved jobs: ${saved}`);
} catch (error) {
    log.error(`Actor failed: ${error.message}`, { error });
    exitCode = 1;
} finally {
    await Actor.exit({ exitCode });
}
