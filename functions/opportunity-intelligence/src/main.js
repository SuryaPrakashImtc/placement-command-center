import { Client, TablesDB, Query } from 'node-appwrite';

const DATABASE_ID = '6aa03d1800119759c9bb';
const JOBS_TABLE_ID = 'jobs';
const PROACTIVE_TABLE_ID = '6abecc4c00069d0c8a5b';

const MAX_COMPANIES_PER_RUN = 3;

// =======================================================
// CANDIDATE TARGETS
// =======================================================

const TARGET_FUNCTIONS = [
  'marketing',
  'brand',
  'branding',
  'growth',
  'digital marketing',
  'product marketing',
  'sales',
  'business development',
  'account management',
  'account executive',
  'sales operations',
  'revenue',
  'commercial',
  'business analyst',
  'business analytics',
  'data analyst',
  'analytics',
  'business intelligence',
  'commercial intelligence',
  'market research',
  'consumer research',
  'insights',
  'strategy'
];

// =======================================================
// HELPERS
// =======================================================

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function daysAgo(dateValue) {
  if (!dateValue) return null;

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return (
    (Date.now() - date.getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countMatches(text, terms) {
  let count = 0;

  for (const term of terms) {
    if (text.includes(term)) {
      count++;
    }
  }

  return count;
}

function containsAny(text, terms) {
  return terms.some(term => text.includes(term));
}

// =======================================================
// TAVILY SEARCH
// =======================================================

async function tavilySearch(
  apiKey,
  query,
  options = {}
) {

  const body = {
    query,
    search_depth: 'basic',
    chunks_per_source: 1,
    max_results: options.maxResults || 5,
    topic: options.topic || 'general',
    include_published_date: true,
    include_answer: false,
    include_raw_content: false,
    language: 'en'
  };

  if (options.timeRange) {
    body.time_range = options.timeRange;
  }

  if (options.country) {
    body.country = options.country;
  }

  const response = await fetch(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Tavily ${response.status}: ${errorText.slice(0, 300)}`
    );
  }

  return await response.json();
}

// =======================================================
// SIGNAL CLASSIFICATION
// =======================================================

function classifySignal(text) {

  const rules = [
    {
      type: 'FUNDING',
      keywords: [
        'funding',
        'raises',
        'raised',
        'series a',
        'series b',
        'series c',
        'investment',
        'investor',
        'capital'
      ]
    },
    {
      type: 'EXPANSION',
      keywords: [
        'expansion',
        'expanding',
        'new office',
        'new market',
        'india expansion',
        'enters india',
        'entering india',
        'expands into',
        'opens office'
      ]
    },
    {
      type: 'HIRING',
      keywords: [
        'hiring',
        'recruiting',
        'recruitment',
        'talent acquisition',
        'headcount',
        'workforce',
        'jobs',
        'employees'
      ]
    },
    {
      type: 'LEADERSHIP_CHANGE',
      keywords: [
        'appointed',
        'appoints',
        'joins as',
        'named as',
        'new chief',
        'new cmo',
        'new cto',
        'new ceo',
        'new president',
        'new vice president',
        'new head'
      ]
    },
    {
      type: 'NEW_BUSINESS',
      keywords: [
        'launches',
        'launched',
        'new business',
        'new vertical',
        'new division',
        'new product',
        'new service',
        'new platform'
      ]
    },
    {
      type: 'GROWTH',
      keywords: [
        'growth',
        'grew',
        'revenue growth',
        'record revenue',
        'scaling',
        'scale-up',
        'scale up'
      ]
    }
  ];

  for (const rule of rules) {
    if (
      rule.keywords.some(
        keyword => text.includes(keyword)
      )
    ) {
      return rule.type;
    }
  }

  return null;
}

// =======================================================
// FUNCTION INFERENCE
// =======================================================

function inferFunction(text, companyJobs) {

  const normalized = normalize(text);

  const functionGroups = [
    {
      name: 'Marketing',
      keywords: [
        'marketing',
        'brand',
        'branding',
        'digital marketing',
        'product marketing',
        'consumer marketing',
        'communications'
      ]
    },
    {
      name: 'Sales / Business Development',
      keywords: [
        'sales',
        'business development',
        'revenue',
        'account',
        'commercial',
        'go-to-market',
        'gtm'
      ]
    },
    {
      name: 'Analytics / Insights',
      keywords: [
        'analytics',
        'data analyst',
        'business analyst',
        'business intelligence',
        'insights',
        'market research',
        'commercial intelligence'
      ]
    }
  ];

  let bestFunction = null;
  let bestScore = 0;

  for (const group of functionGroups) {

    const signalMatches = countMatches(
      normalized,
      group.keywords
    );

    const jobMatches = countMatches(
      normalize(
        companyJobs
          .map(job => [
            job.job_title,
            job.department,
            job.function,
            job.industry
          ].join(' '))
          .join(' ')
      ),
      group.keywords
    );

    const score =
      signalMatches * 2 +
      jobMatches;

    if (score > bestScore) {
      bestScore = score;
      bestFunction = group.name;
    }
  }

  if (!bestFunction) {
    return 'Sales / Marketing / Analytics';
  }

  return bestFunction;
}

// =======================================================
// PEOPLE RESEARCH
// =======================================================

function isHrPerson(text) {

  return containsAny(
    normalize(text),
    [
      'human resources',
      'hr head',
      'head hr',
      'head of hr',
      'talent acquisition',
      'talent partner',
      'talent lead',
      'recruitment head',
      'recruiter',
      'people head',
      'people leader',
      'chief people',
      'people and culture'
    ]
  );
}

function isFunctionalLeader(text, likelyFunction) {

  const normalized = normalize(text);

  const common = [
    'head',
    'director',
    'vp',
    'vice president',
    'chief',
    'leader',
    'lead'
  ];

  if (!containsAny(normalized, common)) {
    return false;
  }

  if (
    likelyFunction === 'Marketing'
  ) {
    return containsAny(
      normalized,
      [
        'marketing',
        'brand',
        'growth',
        'communications'
      ]
    );
  }

  if (
    likelyFunction ===
    'Sales / Business Development'
  ) {
    return containsAny(
      normalized,
      [
        'sales',
        'revenue',
        'business development',
        'commercial',
        'accounts'
      ]
    );
  }

  if (
    likelyFunction ===
    'Analytics / Insights'
  ) {
    return containsAny(
      normalized,
      [
        'analytics',
        'data',
        'insights',
        'business intelligence',
        'strategy'
      ]
    );
  }

  return false;
}

function extractPersonName(title) {

  let value = String(title || '')
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .trim();

  if (value.includes(' - ')) {
    value = value.split(' - ')[0].trim();
  }

  if (value.includes(' | ')) {
    value = value.split(' | ')[0].trim();
  }

  if (
    value.length < 2 ||
    value.length > 80
  ) {
    return 'Unknown';
  }

  return value;
}

async function researchPeople(
  apiKey,
  companyName,
  likelyFunction
) {

  const query =
    `"${companyName}" ` +
    `(HR OR "Human Resources" OR "Talent Acquisition" OR ` +
    `"Recruitment Head" OR "Head of Marketing" OR ` +
    `"Head of Sales" OR "Business Head" OR ` +
    `"Head of Analytics" OR "Strategy Head") ` +
    `site:linkedin.com/in`;

  const data = await tavilySearch(
    apiKey,
    query,
    {
      topic: 'general',
      country: 'india',
      maxResults: 8
    }
  );

  const results =
    Array.isArray(data.results)
      ? data.results
      : [];

  const people = [];

  for (const result of results) {

    const combinedText = normalize([
      result.title,
      result.content
    ].join(' '));

    const hr = isHrPerson(
      combinedText
    );

    const functional =
      isFunctionalLeader(
        combinedText,
        likelyFunction
      );

    if (!hr && !functional) {
      continue;
    }

    people.push({
      name:
        extractPersonName(result.title),
      title:
        result.title || 'Unknown',
      profileUrl:
        result.url || null,
      roleType:
        hr ? 'HR / Talent' : 'Functional Leader',
      whyRelevant:
        hr
          ? 'Publicly identifiable HR/Talent professional; likely closer to hiring coordination and talent decisions than a general corporate executive.'
          : `Publicly identifiable ${likelyFunction} leader; likely closer to the future functional need than a general corporate executive.`,
      evidence:
        result.content || ''
    });
  }

  const primary =
    people.find(
      person => person.roleType === 'HR / Talent'
    ) || null;

  const secondary =
    people.find(
      person =>
        person.roleType ===
        'Functional Leader' &&
        person.name !== primary?.name
    ) || null;

  return {
    primary,
    secondary,
    candidatesFound: people.length
  };
}

// =======================================================
// EXISTING JOB SCORING
// =======================================================

function calculateCompanyQuality(
  job,
  companyJobCount,
  signalTypes
) {

  let score = 0;

  // Named company = evidence, not a penalty.
  if (
    job.company_name &&
    normalize(job.company_name) !== 'unknown'
  ) {
    score += 8;
  }

  if (
    job.company_size &&
    normalize(job.company_size) !== 'unknown'
  ) {
    score += 5;
  }

  if (
    job.company_type &&
    normalize(job.company_type) !== 'unknown'
  ) {
    score += 4;
  }

  if (companyJobCount >= 5) {
    score += 5;
  } else if (companyJobCount >= 3) {
    score += 3;
  } else if (companyJobCount >= 2) {
    score += 2;
  }

  if (
    signalTypes.includes('EXPANSION') ||
    signalTypes.includes('FUNDING') ||
    signalTypes.includes('GROWTH')
  ) {
    score += 3;
  }

  return clamp(score, 0, 25);
}

function calculateCandidateRelevance(
  matchStatus
) {

  switch (
    normalize(matchStatus)
  ) {

    case 'high_match':
      return 20;

    case 'medium_match':
      return 15;

    case 'low_match':
      return 8;

    case 'not_a_match':
      return 0;

    default:
      return 10;
  }
}

function calculateHiringLikelihood(
  companyJobCount,
  signalTypes
) {

  let score = 1;

  if (companyJobCount >= 5) {
    score += 7;
  } else if (companyJobCount >= 3) {
    score += 5;
  } else if (companyJobCount >= 2) {
    score += 3;
  }

  if (
    signalTypes.includes('HIRING')
  ) {
    score += 5;
  }

  if (
    signalTypes.includes('EXPANSION') ||
    signalTypes.includes('FUNDING')
  ) {
    score += 3;
  }

  return clamp(score, 0, 15);
}

function calculateRecency(
  jobDate
) {

  const age =
    daysAgo(jobDate);

  if (age === null) {
    return 2;
  }

  if (age <= 1) return 10;
  if (age <= 3) return 8;
  if (age <= 7) return 6;
  if (age <= 14) return 4;
  if (age <= 30) return 2;

  return 0;
}

function calculateEvidenceConfidence(
  job,
  signalStrength
) {

  let score = 0;

  if (
    job.job_title &&
    job.job_description
  ) {
    score++;
  }

  if (
    job.company_name &&
    normalize(job.company_name) !== 'unknown'
  ) {
    score++;
  }

  if (job.location) {
    score++;
  }

  if (job.job_posted_date) {
    score++;
  }

  if (signalStrength > 0) {
    score++;
  }

  return clamp(score, 0, 5);
}

function existingStatus(score) {

  if (score >= 70) {
    return 'PRIORITY';
  }

  if (score >= 50) {
    return 'WATCH';
  }

  return 'BACKLOG';
}

// =======================================================
// PROACTIVE SCORE
// =======================================================

function proactiveCandidateRelevance(
  likelyFunction,
  companyJobs
) {

  const functionText =
    normalize(likelyFunction);

  let score = 8;

  if (
    functionText.includes('marketing')
  ) {
    score = 18;
  }

  if (
    functionText.includes('sales')
  ) {
    score = 18;
  }

  if (
    functionText.includes('analytics')
  ) {
    score = 18;
  }

  const relevantJobs =
    companyJobs.filter(job =>
      normalize([
        job.job_title,
        job.function,
        job.department,
        job.industry
      ].join(' '))
        .split(' ')
        .some(word =>
          TARGET_FUNCTIONS.includes(word)
        )
    );

  if (relevantJobs.length > 0) {
    score = 20;
  }

  return clamp(score, 0, 20);
}

function calculateProactiveScore(
  companyQuality,
  signalStrength,
  candidateRelevance,
  hiringLikelihood,
  recency,
  evidenceConfidence
) {

  return clamp(
    companyQuality +
    signalStrength +
    candidateRelevance +
    hiringLikelihood +
    recency +
    evidenceConfidence,
    0,
    100
  );
}

function proactiveStatus(
  score,
  hasPerson
) {

  if (
    score >= 70 &&
    hasPerson
  ) {
    return 'CONTACT_READY';
  }

  if (score >= 50) {
    return 'WATCH';
  }

  return 'MONITOR';
}

// =======================================================
// WHY THIS MATTERS
// =======================================================

function buildWhyThisMatters(
  signalType,
  likelyFunction
) {

  const explanations = {
    FUNDING:
      'The company has a recent capital/investment signal that can create capacity for expansion, team building, or new functional hiring.',

    EXPANSION:
      'The company appears to be expanding into a market, location, or business area, which can create new commercial and support-function requirements.',

    HIRING:
      'Recent hiring activity indicates active talent demand and may precede additional openings in adjacent functions.',

    LEADERSHIP_CHANGE:
      'A leadership change can precede team restructuring, new priorities, or capability-building around the incoming leader.',

    NEW_BUSINESS:
      'A new business, product, or vertical can create additional go-to-market, marketing, sales, and analytics requirements.',

    GROWTH:
      'Recent growth signals can increase the need for commercial, marketing, sales, and analytical capabilities.'
  };

  return (
    explanations[signalType] ||
    'A recent company development may create future hiring demand.'
  ) +
  ` Likely relevant area: ${likelyFunction}.`;
}

// =======================================================
// OUTREACH ANGLE
// =======================================================

function buildOutreachAngle(
  signalType,
  likelyFunction,
  personType
) {

  const opening =
    signalType === 'EXPANSION'
      ? 'Reference the specific expansion signal and show that you noticed it before a role was publicly advertised.'
      : signalType === 'FUNDING'
      ? 'Reference the funding/growth event and connect it to the capabilities the company may need as it scales.'
      : signalType === 'LEADERSHIP_CHANGE'
      ? 'Reference the leadership change and thoughtfully connect it to the direction the function may be moving.'
      : signalType === 'NEW_BUSINESS'
      ? 'Reference the new business/vertical and discuss the commercial or marketing capabilities it may require.'
      : signalType === 'HIRING'
      ? 'Reference the visible hiring activity and the possibility of adjacent team expansion.'
      : 'Reference the recent company development and connect it to the likely functional requirement.';

  const candidateBridge =
    likelyFunction === 'Marketing'
      ? 'Bridge to your B2B marketing communications, multi-city product-launch, stakeholder and agency coordination experience.'
      : likelyFunction ===
        'Sales / Business Development'
      ? 'Bridge to your B2B prospecting, lead-generation, client-acquisition and stakeholder experience.'
      : likelyFunction ===
        'Analytics / Insights'
      ? 'Bridge to your Power BI, Excel/Power Query/Power Pivot/DAX and commercial/marketing analytics work.'
      : 'Bridge to your combination of marketing, B2B and analytics experience.';

  const close =
    personType === 'HR / Talent'
      ? 'Ask about how the team is thinking about the capability build rather than directly asking whether a vacancy exists.'
      : 'Ask an informed question about the capability the function is likely to need next, rather than opening with a generic job request.';

  return `${opening} ${candidateBridge} ${close}`;
}

// =======================================================
// PROACTIVE RECORD UPSERT
// =======================================================

async function upsertProactiveOpportunity(
  tablesDB,
  payload
) {

  const existing =
    await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: PROACTIVE_TABLE_ID,
      queries: [
        Query.equal(
          'company_name',
          payload.company_name
        ),
        Query.equal(
          'signal_type',
          payload.signal_type
        ),
        Query.limit(5)
      ]
    });

  if (
    existing.rows &&
    existing.rows.length > 0
  ) {

    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: PROACTIVE_TABLE_ID,
      rowId: existing.rows[0].$id,
      data: payload
    });

    return 'UPDATED';
  }

  const { ID } = await import(
    'node-appwrite'
  );

  await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: PROACTIVE_TABLE_ID,
    rowId: ID.unique(),
    data: payload
  });

  return 'CREATED';
}

// =======================================================
// MAIN
// =======================================================

export default async ({
  req,
  res,
  log,
  error
}) => {

  try {

    const apiKey =
      process.env.TAVILY_API_KEY;

    if (!apiKey) {
      throw new Error(
        'TAVILY_API_KEY is not available. Redeploy the function after adding the project variable.'
      );
    }

    const client = new Client()
      .setEndpoint(
        process.env.APPWRITE_FUNCTION_API_ENDPOINT
      )
      .setProject(
        process.env.APPWRITE_FUNCTION_PROJECT_ID
      )
      .setKey(
        process.env.JOB_AUTOMATION_API_KEY
      );

    const tablesDB =
      new TablesDB(client);

    // ===================================================
    // LOAD ALL JOBS
    // ===================================================

    let allJobs = [];
    let cursor = null;

    while (true) {

      const queries = [
        Query.limit(100)
      ];

      if (cursor) {
        queries.push(
          Query.cursorAfter(cursor)
        );
      }

      const page =
        await tablesDB.listRows({
          databaseId: DATABASE_ID,
          tableId: JOBS_TABLE_ID,
          queries
        });

      const rows =
        page.rows || [];

      allJobs.push(...rows);

      if (rows.length < 100) {
        break;
      }

      cursor =
        rows[rows.length - 1].$id;
    }

    // ===================================================
    // COMPANY GROUPING
    // ===================================================

    const companyMap = new Map();

    for (const job of allJobs) {

      const companyName =
        String(
          job.company_name || ''
        ).trim();

      const companyKey =
        normalize(companyName);

      if (!companyKey) {
        continue;
      }

      if (!companyMap.has(companyKey)) {
        companyMap.set(
          companyKey,
          {
            name: companyName,
            jobs: []
          }
        );
      }

      companyMap
        .get(companyKey)
        .jobs
        .push(job);
    }

    const companies =
      [...companyMap.values()]
        .sort((a, b) =>
          normalize(a.name)
            .localeCompare(
              normalize(b.name)
            )
        );

    // ===================================================
    // DAILY ROTATION
    // ===================================================

    const dayNumber =
      Math.floor(
        Date.now() /
        (1000 * 60 * 60 * 24)
      );

    const startIndex =
      (
        dayNumber *
        MAX_COMPANIES_PER_RUN
      ) % Math.max(
        companies.length,
        1
      );

    const companiesToCheck = [];

    for (
      let i = 0;
      i < Math.min(
        MAX_COMPANIES_PER_RUN,
        companies.length
      );
      i++
    ) {

      companiesToCheck.push(
        companies[
          (startIndex + i) %
          companies.length
        ]
      );
    }

    // ===================================================
    // COMPANY SIGNAL CACHE
    // ===================================================

    const signalCache =
      new Map();

    let signalSearches = 0;
    let peopleSearches = 0;
    let tavilyErrors = 0;

    let proactiveSignalsFound = 0;
    let proactiveCreated = 0;
    let proactiveUpdated = 0;

    // ===================================================
    // RESEARCH SELECTED COMPANIES
    // ===================================================

    for (
      const company of companiesToCheck
    ) {

      const companyJobs =
        company.jobs;

      try {

        const signalQuery =
          `"${company.name}" ` +
          `(hiring OR expansion OR funding OR ` +
          `"new office" OR "new business" OR ` +
          `"new vertical" OR leadership OR growth) ` +
          `India`;

        const news =
          await tavilySearch(
            apiKey,
            signalQuery,
            {
              topic: 'news',
              timeRange: 'month',
              maxResults: 5
            }
          );

        signalSearches++;

        const results =
          Array.isArray(news.results)
            ? news.results
            : [];

        const signalResults = [];

        for (const result of results) {

          const combinedText =
            normalize([
              result.title,
              result.content
            ].join(' '));

          const signalType =
            classifySignal(
              combinedText
            );

          if (!signalType) {
            continue;
          }

          signalResults.push({
            title:
              result.title || '',
            url:
              result.url || '',
            content:
              result.content || '',
            publishedDate:
              result.published_date || null,
            signalType
          });
        }

        // Highest quality signals first.
        signalResults.sort(
          (a, b) => {

            const aAge =
              daysAgo(
                a.publishedDate
              );

            const bAge =
              daysAgo(
                b.publishedDate
              );

            return (
              (aAge ?? 999) -
              (bAge ?? 999)
            );
          }
        );

        const uniqueSignalTypes =
          unique(
            signalResults.map(
              item => item.signalType
            )
          );

        let signalScore = 0;

        for (
          const signal of
          signalResults.slice(0, 3)
        ) {

          const age =
            daysAgo(
              signal.publishedDate
            );

          if (
            age !== null &&
            age <= 7
          ) {
            signalScore += 6;
          } else if (
            age !== null &&
            age <= 14
          ) {
            signalScore += 4;
          } else {
            signalScore += 2;
          }
        }

        signalScore +=
          Math.min(
            uniqueSignalTypes.length * 2,
            6
          );

        signalScore =
          clamp(
            signalScore,
            0,
            25
          );

        const signalData = {
          signalResults:
            signalResults.slice(0, 5),
          signalTypes:
            uniqueSignalTypes,
          signalScore
        };

        signalCache.set(
          normalize(company.name),
          signalData
        );

        if (
          signalResults.length === 0
        ) {
          continue;
        }

        proactiveSignalsFound++;

        // =================================================
        // SELECT BEST SIGNAL
        // =================================================

        const bestSignal =
          signalResults[0];

        const likelyFunction =
          inferFunction(
            [
              bestSignal.title,
              bestSignal.content
            ].join(' '),
            companyJobs
          );

        // =================================================
        // PEOPLE SEARCH
        // =================================================

        let people = {
          primary: null,
          secondary: null,
          candidatesFound: 0
        };

        try {

          people =
            await researchPeople(
              apiKey,
              company.name,
              likelyFunction
            );

          peopleSearches++;

        } catch (peopleError) {

          peopleSearches++;
          tavilyErrors++;

          error(
            `People research failed for ${company.name}: ${peopleError.message}`
          );
        }

        // =================================================
        // COMPANY QUALITY
        // =================================================

        const representativeJob =
          companyJobs[0] || {};

        const companyQuality =
          calculateCompanyQuality(
            representativeJob,
            companyJobs.length,
            uniqueSignalTypes
          );

        // =================================================
        // PROACTIVE DIMENSIONS
        // =================================================

        const signalStrength =
          signalScore;

        const candidateRelevance =
          proactiveCandidateRelevance(
            likelyFunction,
            companyJobs
          );

        const hiringLikelihood =
          calculateHiringLikelihood(
            companyJobs.length,
            uniqueSignalTypes
          );

        const recency =
          calculateRecency(
            bestSignal.publishedDate
          );

        const evidenceConfidence =
          clamp(
            2 +
            (
              signalResults.length >= 2
                ? 1
                : 0
            ) +
            (
              uniqueSignalTypes.length >= 2
                ? 1
                : 0
            ) +
            (
              people.primary ||
              people.secondary
                ? 1
                : 0
            ),
            0,
            5
          );

        const proactiveScore =
          calculateProactiveScore(
            companyQuality,
            signalStrength,
            candidateRelevance,
            hiringLikelihood,
            recency,
            evidenceConfidence
          );

        const hasPerson =
          Boolean(
            people.primary ||
            people.secondary
          );

        const status =
          proactiveStatus(
            proactiveScore,
            hasPerson
          );

        const currentRelevantJob =
          companyJobs.some(
            job =>
              job.eligibility_status ===
                'ELIGIBLE' ||
              job.eligibility_status ===
                'UNKNOWN'
          );

        const personType =
          people.primary
            ? 'HR / Talent'
            : people.secondary
            ? 'Functional Leader'
            : 'No person found';

        const outreachAngle =
          buildOutreachAngle(
            bestSignal.signalType,
            likelyFunction,
            personType
          );

        const signalEvidence = {
          checkedAt:
            new Date().toISOString(),
          bestSignal,
          additionalSignals:
            signalResults.slice(1, 5),
          signalTypes:
            uniqueSignalTypes
        };

        const peopleIntelligence = {
          primary:
            people.primary,
          secondary:
            people.secondary,
          candidatesFound:
            people.candidatesFound
        };

        const payload = {

          company_name:
            company.name,

          company_url:
            null,

          signal_type:
            bestSignal.signalType,

          signal_date:
            bestSignal.publishedDate
              ? new Date(
                  bestSignal.publishedDate
                ).toISOString()
              : new Date().toISOString(),

          signal_source:
            'Tavily',

          signal_url:
            bestSignal.url || null,

          signal_evidence:
            JSON.stringify(
              signalEvidence
            ),

          likely_function:
            likelyFunction,

          likely_role_area:
            `${likelyFunction} capability build`,

          current_relevant_job_found:
            currentRelevantJob,

          proactive_score:
            proactiveScore,

          proactive_status:
            status,

          score_breakdown:
            JSON.stringify({
              totalScore:
                proactiveScore,

              companyQuality: {
                score:
                  companyQuality,
                max: 25
              },

              signalStrength: {
                score:
                  signalStrength,
                max: 25
              },

              candidateRelevance: {
                score:
                  candidateRelevance,
                max: 20
              },

              hiringLikelihood: {
                score:
                  hiringLikelihood,
                max: 15
              },

              recency: {
                score:
                  recency,
                max: 10
              },

              evidenceConfidence: {
                score:
                  evidenceConfidence,
                max: 5
              }
            }),

          people_intelligence:
            JSON.stringify(
              peopleIntelligence
            ),

          recommended_outreach_angle:
            outreachAngle,

          approval_status:
            'PENDING',

          outreach_status:
            'NOT_CONTACTED',

          first_seen_date:
            new Date().toISOString(),

          last_checked_date:
            new Date().toISOString(),

          next_check_date:
            new Date(
              Date.now() +
              7 *
              24 *
              60 *
              60 *
              1000
            ).toISOString()
        };

        const result =
          await upsertProactiveOpportunity(
            tablesDB,
            payload
          );

        if (result === 'CREATED') {
          proactiveCreated++;
        } else {
          proactiveUpdated++;
        }

      } catch (companyError) {

        tavilyErrors++;

        error(
          `Opportunity research failed for ${company.name}: ${companyError.message}`
        );
      }
    }

    // ===================================================
    // UPDATE EXISTING JOB SCORES
    // ===================================================

    let evaluated = 0;
    let priority = 0;
    let watch = 0;
    let backlog = 0;
    let skipped = 0;
    let failed = 0;

    for (const job of allJobs) {

      try {

        if (
          job.eligibility_status ===
          'NOT_ELIGIBLE'
        ) {
          skipped++;
          continue;
        }

        const companyKey =
          normalize(
            job.company_name
          );

        const freshSignal =
          signalCache.get(
            companyKey
          );

        // Preserve previous signal intelligence
        // for companies not researched today.
        let signalScore = 0;
        let signalTypes = [];

        if (freshSignal) {

          signalScore =
            freshSignal.signalScore;

          signalTypes =
            freshSignal.signalTypes;

        } else {

          const previous =
            safeJsonParse(
              job.opportunity_breakdown,
              null
            );

          if (
            previous &&
            previous.signalStrength
          ) {

            signalScore =
              Number(
                previous.signalStrength.score
              ) || 0;

            signalTypes =
              Array.isArray(
                previous.signalStrength.signalTypes
              )
                ? previous.signalStrength.signalTypes
                : [];
          }
        }

        const companyRecord =
          companyMap.get(
            companyKey
          );

        const companyJobCount =
          companyRecord
            ? companyRecord.jobs.length
            : 1;

        const companyQuality =
          calculateCompanyQuality(
            job,
            companyJobCount,
            signalTypes
          );

        const candidateRelevance =
          calculateCandidateRelevance(
            job.match_status
          );

        const hiringLikelihood =
          calculateHiringLikelihood(
            companyJobCount,
            signalTypes
          );

        const recency =
          calculateRecency(
            job.job_posted_date
          );

        const evidenceConfidence =
          calculateEvidenceConfidence(
            job,
            signalScore
          );

        const totalScore =
          clamp(
            companyQuality +
            signalScore +
            candidateRelevance +
            hiringLikelihood +
            recency +
            evidenceConfidence,
            0,
            100
          );

        const status =
          existingStatus(
            totalScore
          );

        const breakdown = {
          totalScore,

          companyQuality: {
            score:
              companyQuality,
            max: 25
          },

          signalStrength: {
            score:
              signalScore,
            max: 25,
            signalTypes
          },

          candidateRelevance: {
            score:
              candidateRelevance,
            max: 20,
            matchStatus:
              job.match_status
          },

          hiringLikelihood: {
            score:
              hiringLikelihood,
            max: 15,
            companyOpenings:
              companyJobCount
          },

          recency: {
            score:
              recency,
            max: 10,
            postedDate:
              job.job_posted_date
          },

          evidenceConfidence: {
            score:
              evidenceConfidence,
            max: 5
          },

          evaluatedAt:
            new Date().toISOString()
        };

        await tablesDB.updateRow({
          databaseId: DATABASE_ID,
          tableId: JOBS_TABLE_ID,
          rowId: job.$id,
          data: {
            opportunity_score:
              totalScore,

            opportunity_status:
              status,

            opportunity_breakdown:
              JSON.stringify(
                breakdown
              )
          }
        });

        evaluated++;

        if (status === 'PRIORITY') {
          priority++;
        } else if (
          status === 'WATCH'
        ) {
          watch++;
        } else {
          backlog++;
        }

      } catch (jobError) {

        failed++;

        error(
          `Existing opportunity scoring failed for ${job.$id}: ${jobError.message}`
        );
      }
    }

    // ===================================================
    // RESULT
    // ===================================================

    return res.json({

      status: 'SUCCESS',

      existingOpportunities: {
        jobsFound:
          allJobs.length,

        evaluated,

        priority,
        watch,
        backlog,

        skippedNotEligible:
          skipped,

        failed
      },

      proactiveIntelligence: {

        companiesAvailable:
          companies.length,

        companiesChecked:
          companiesToCheck.length,

        signalSearches,

        peopleSearches,

        signalsFound:
          proactiveSignalsFound,

        recordsCreated:
          proactiveCreated,

        recordsUpdated:
          proactiveUpdated,

        tavilyErrors
      },

      estimatedTavilyCredits:
        signalSearches +
        peopleSearches
    });

  } catch (err) {

    error(err.message);

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
