import { Client, TablesDB, Query, ID } from 'node-appwrite';

const DATABASE_ID = '6aa03d1800119759c9bb';
const JOBS_TABLE_ID = 'jobs';
const PROACTIVE_TABLE_ID = '6abecc4c00069d0c8a5b';

// TEST MODE.
// After successful testing, we will increase this for the daily run.
const MAX_COMPANIES_PER_RUN = 2;

// =======================================================
// TARGET FUNCTIONS
// =======================================================

const TARGET_FUNCTIONS = {
  marketing: [
    'marketing',
    'brand',
    'branding',
    'digital marketing',
    'product marketing',
    'consumer marketing',
    'marketing communications',
    'communications'
  ],

  sales: [
    'sales',
    'business development',
    'revenue',
    'commercial',
    'account management',
    'account executive',
    'sales operations',
    'go-to-market',
    'gtm'
  ],

  analytics: [
    'analytics',
    'data analyst',
    'business analyst',
    'business analytics',
    'business intelligence',
    'insights',
    'commercial intelligence',
    'market research',
    'consumer research'
  ]
};

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

function countMatches(text, keywords) {
  const normalized = normalize(text);

  return keywords.reduce(
    (count, keyword) =>
      count +
      (normalized.includes(keyword) ? 1 : 0),
    0
  );
}

function daysAgo(dateValue) {
  if (!dateValue) {
    return null;
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return (
    Date.now() - date.getTime()
  ) / (1000 * 60 * 60 * 24);
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

// =======================================================
// TAVILY
// =======================================================

async function tavilySearch(
  apiKey,
  query,
  options = {}
) {
  const body = {
    query,
    search_depth: 'basic',
    max_results: options.maxResults || 5,
    topic: options.topic || 'general',
    include_published_date: true,
    include_answer: false,
    include_raw_content: false
  };

  if (options.timeRange) {
    body.time_range = options.timeRange;
  }

  const response = await fetch(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Tavily ${response.status}: ${text.slice(0, 300)}`
    );
  }

  return JSON.parse(text);
}

// =======================================================
// SIGNAL CLASSIFICATION
// =======================================================

function classifySignal(text) {
  const rules = [
    {
      type: 'EXPANSION',
      keywords: [
        'expansion',
        'expanding',
        'new office',
        'opens office',
        'opening office',
        'new market',
        'entering india',
        'india expansion',
        'expands into'
      ]
    },

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
      type: 'HIRING',
      keywords: [
        'hiring',
        'recruiting',
        'recruitment',
        'talent acquisition',
        'headcount',
        'workforce',
        'hiring spree',
        'jobs'
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
        'new ceo',
        'new president',
        'new vice president',
        'new head'
      ]
    },

    {
      type: 'NEW_BUSINESS',
      keywords: [
        'new business',
        'new vertical',
        'new division',
        'new product',
        'new service',
        'new platform',
        'launches'
      ]
    },

    {
      type: 'GROWTH',
      keywords: [
        'growth',
        'grew',
        'revenue growth',
        'scaling',
        'scale up',
        'scale-up',
        'record revenue'
      ]
    }
  ];

  const normalized = normalize(text);

  for (const rule of rules) {
    if (
      rule.keywords.some(
        keyword => normalized.includes(keyword)
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

function inferFunction(signalText, companyJobs) {
  const jobText = normalize(
    companyJobs
      .map(job => [
        job.job_title,
        job.department,
        job.function,
        job.industry,
        job.job_description
      ].join(' '))
      .join(' ')
  );

  const text = normalize(
    `${signalText} ${jobText}`
  );

  const scores = {
    Marketing: countMatches(
      text,
      TARGET_FUNCTIONS.marketing
    ),

    'Sales / Business Development':
      countMatches(
        text,
        TARGET_FUNCTIONS.sales
      ),

    'Analytics / Insights':
      countMatches(
        text,
        TARGET_FUNCTIONS.analytics
      )
  };

  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1]);

  if (sorted[0][1] === 0) {
    return 'Sales / Marketing / Analytics';
  }

  return sorted[0][0];
}

// =======================================================
// EXISTING JOB SCORING
// =======================================================

function calculateExistingScore(job, companyJobCount) {

  const jobText = normalize([
    job.job_title,
    job.department,
    job.function,
    job.industry,
    job.job_description
  ].join(' '));

  let candidateRelevance = 0;

  const allKeywords = [
    ...TARGET_FUNCTIONS.marketing,
    ...TARGET_FUNCTIONS.sales,
    ...TARGET_FUNCTIONS.analytics
  ];

  const roleMatches =
    countMatches(
      jobText,
      allKeywords
    );

  if (roleMatches >= 5) {
    candidateRelevance = 40;
  } else if (roleMatches >= 3) {
    candidateRelevance = 32;
  } else if (roleMatches >= 2) {
    candidateRelevance = 24;
  } else if (roleMatches >= 1) {
    candidateRelevance = 16;
  } else {
    candidateRelevance = 5;
  }

  const age =
    daysAgo(job.job_posted_date);

  let recency = 3;

  if (age !== null) {
    if (age <= 1) {
      recency = 20;
    } else if (age <= 3) {
      recency = 17;
    } else if (age <= 7) {
      recency = 14;
    } else if (age <= 14) {
      recency = 10;
    } else if (age <= 30) {
      recency = 6;
    } else {
      recency = 2;
    }
  }

  let hiringLikelihood = 3;

  if (companyJobCount >= 5) {
    hiringLikelihood = 15;
  } else if (companyJobCount >= 3) {
    hiringLikelihood = 12;
  } else if (companyJobCount >= 2) {
    hiringLikelihood = 9;
  }

  // The existence of an actual live job is itself evidence
  // of hiring activity.
  hiringLikelihood = clamp(
    hiringLikelihood + 5,
    0,
    15
  );

  let companyQuality = 5;

  if (
    job.company_name &&
    normalize(job.company_name) !== 'unknown'
  ) {
    companyQuality += 3;
  }

  if (
    job.company_type &&
    normalize(job.company_type) !== 'unknown'
  ) {
    companyQuality += 2;
  }

  if (
    job.company_size &&
    normalize(job.company_size) !== 'unknown'
  ) {
    companyQuality += 2;
  }

  companyQuality = clamp(
    companyQuality,
    0,
    10
  );

  // No external signal is NOT a negative score.
  const signalStrength = 5;

  let evidenceConfidence = 2;

  if (
    job.job_title &&
    job.job_description
  ) {
    evidenceConfidence += 1;
  }

  if (job.company_name) {
    evidenceConfidence += 1;
  }

  if (job.job_posted_date) {
    evidenceConfidence += 1;
  }

  evidenceConfidence =
    clamp(
      evidenceConfidence,
      0,
      5
    );

  const total =
    clamp(
      candidateRelevance +
      recency +
      hiringLikelihood +
      companyQuality +
      signalStrength +
      evidenceConfidence,
      0,
      100
    );

  let status = 'BACKLOG';

  if (total >= 65) {
    status = 'PRIORITY';
  } else if (total >= 45) {
    status = 'WATCH';
  }

  return {
    total,
    status,
    candidateRelevance,
    recency,
    hiringLikelihood,
    companyQuality,
    signalStrength,
    evidenceConfidence
  };
}

// =======================================================
// PROACTIVE SCORING
// =======================================================

function proactiveCandidateRelevance(
  likelyFunction,
  companyJobs
) {
  const functionText =
    normalize(likelyFunction);

  let score = 12;

  if (
    functionText.includes('marketing') ||
    functionText.includes('sales') ||
    functionText.includes('analytics')
  ) {
    score = 17;
  }

  const companyJobText = normalize(
    companyJobs
      .map(job => [
        job.job_title,
        job.department,
        job.function
      ].join(' '))
      .join(' ')
  );

  if (
    containsAny(
      companyJobText,
      likelyFunction === 'Marketing'
        ? TARGET_FUNCTIONS.marketing
        : likelyFunction ===
          'Sales / Business Development'
        ? TARGET_FUNCTIONS.sales
        : TARGET_FUNCTIONS.analytics
    )
  ) {
    score = 20;
  }

  return clamp(score, 0, 20);
}

function containsAny(text, keywords) {
  const normalized = normalize(text);

  return keywords.some(
    keyword =>
      normalized.includes(keyword)
  );
}

function calculateProactiveScore({
  companyQuality,
  signalStrength,
  candidateRelevance,
  hiringLikelihood,
  recency,
  evidenceConfidence
}) {
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

function getProactiveStatus(
  score,
  peopleFound
) {
  if (
    score >= 65 &&
    peopleFound
  ) {
    return 'CONTACT_READY';
  }

  if (score >= 45) {
    return 'WATCH';
  }

  return 'SIGNAL_DETECTED';
}

// =======================================================
// PEOPLE RESEARCH
// =======================================================

function isHrPerson(text) {
  return containsAny(
    text,
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

function isFunctionalLeader(
  text,
  likelyFunction
) {
  if (
    !containsAny(
      text,
      [
        'head',
        'director',
        'vp',
        'vice president',
        'chief',
        'leader',
        'lead'
      ]
    )
  ) {
    return false;
  }

  if (
    likelyFunction === 'Marketing'
  ) {
    return containsAny(
      text,
      TARGET_FUNCTIONS.marketing
    );
  }

  if (
    likelyFunction ===
    'Sales / Business Development'
  ) {
    return containsAny(
      text,
      TARGET_FUNCTIONS.sales
    );
  }

  if (
    likelyFunction ===
    'Analytics / Insights'
  ) {
    return containsAny(
      text,
      TARGET_FUNCTIONS.analytics
    );
  }

  return false;
}

function extractPersonName(title) {
  let value =
    String(title || '')
      .replace(
        /\s*\|\s*LinkedIn.*$/i,
        ''
      )
      .trim();

  if (value.includes(' - ')) {
    value =
      value.split(' - ')[0]
        .trim();
  }

  if (value.includes(' | ')) {
    value =
      value.split(' | ')[0]
        .trim();
  }

  if (
    value.length < 2 ||
    value.length > 100
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
    `(HR OR "Human Resources" OR ` +
    `"Talent Acquisition" OR Recruiter OR ` +
    `"HR Head" OR "Head of HR" OR ` +
    `"Head of Marketing" OR "Head of Sales" OR ` +
    `"Business Head" OR "Head of Analytics" OR ` +
    `"Strategy Head")`;

  const data =
    await tavilySearch(
      apiKey,
      query,
      {
        topic: 'general',
        maxResults: 8
      }
    );

  const results =
    Array.isArray(data.results)
      ? data.results
      : [];

  const people = [];

  for (const result of results) {

    const text =
      normalize([
        result.title,
        result.content
      ].join(' '));

    const hr =
      isHrPerson(text);

    const functional =
      isFunctionalLeader(
        text,
        likelyFunction
      );

    if (!hr && !functional) {
      continue;
    }

    people.push({
      name:
        extractPersonName(
          result.title
        ),

      title:
        result.title || 'Unknown',

      profileUrl:
        result.url || '',

      roleType:
        hr
          ? 'HR / Talent'
          : 'Functional Leader',

      whyRelevant:
        hr
          ? 'HR/Talent professional identified in public professional information; relevant to hiring coordination and talent decisions.'
          : `Functional leader identified in public professional information; relevant to the likely ${likelyFunction} capability.`,

      evidence:
        result.content || ''
    });
  }

  const primary =
    people.find(
      person =>
        person.roleType ===
        'HR / Talent'
    ) || null;

  const secondary =
    people.find(
      person =>
        person.roleType ===
        'Functional Leader' &&
        person.name !==
          primary?.name
    ) || null;

  return {
    primary,
    secondary,
    candidatesFound:
      people.length
  };
}

// =======================================================
// OUTREACH ANGLE
// =======================================================

function buildOutreachAngle(
  signalType,
  likelyFunction
) {
  let signalAngle;

  switch (signalType) {

    case 'EXPANSION':
      signalAngle =
        'Reference the specific expansion and demonstrate that you noticed the development before a role was publicly advertised.';
      break;

    case 'FUNDING':
      signalAngle =
        'Reference the funding/growth event and connect it to the capabilities the company may need as it scales.';
      break;

    case 'LEADERSHIP_CHANGE':
      signalAngle =
        'Reference the leadership change and thoughtfully connect it to the direction the function may be building toward.';
      break;

    case 'NEW_BUSINESS':
      signalAngle =
        'Reference the new business or vertical and connect it to the capabilities that may be required to build it.';
      break;

    case 'HIRING':
      signalAngle =
        'Reference the visible hiring activity and explore whether adjacent capability-building is underway.';
      break;

    default:
      signalAngle =
        'Reference the recent company development and connect it to the likely functional requirement.';
  }

  let candidateBridge;

  if (
    likelyFunction === 'Marketing'
  ) {
    candidateBridge =
      'Bridge this to your B2B marketing communications, commercial product-launch, stakeholder, agency and event experience.';
  } else if (
    likelyFunction ===
    'Sales / Business Development'
  ) {
    candidateBridge =
      'Bridge this to your B2B prospecting, lead generation, client acquisition and stakeholder experience.';
  } else if (
    likelyFunction ===
    'Analytics / Insights'
  ) {
    candidateBridge =
      'Bridge this to your Power BI, Excel/Power Query/Power Pivot/DAX and commercial/marketing analytics work.';
  } else {
    candidateBridge =
      'Bridge this to your combination of marketing, B2B and analytics experience.';
  }

  return `${signalAngle} ${candidateBridge} Do not open with a generic request for a job; start with the company development and your relevant perspective.`;
}

// =======================================================
// FETCH ALL JOBS
// =======================================================

async function fetchAllJobs(tablesDB) {

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
        databaseId:
          DATABASE_ID,
        tableId:
          JOBS_TABLE_ID,
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

  return allJobs;
}

// =======================================================
// UPSERT PROACTIVE RECORD
// =======================================================

async function upsertProactive(
  tablesDB,
  payload
) {

  const existing =
    await tablesDB.listRows({
      databaseId:
        DATABASE_ID,
      tableId:
        PROACTIVE_TABLE_ID,
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
      databaseId:
        DATABASE_ID,
      tableId:
        PROACTIVE_TABLE_ID,
      rowId:
        existing.rows[0].$id,
      data:
        payload
    });

    return 'UPDATED';
  }

  await tablesDB.createRow({
    databaseId:
      DATABASE_ID,
    tableId:
      PROACTIVE_TABLE_ID,
    rowId:
      ID.unique(),
    data:
      payload
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

    const appwriteKey =
      process.env.JOB_AUTOMATION_API_KEY;

    const tavilyKey =
      process.env.TAVILY_API_KEY;

    if (!appwriteKey) {
      throw new Error(
        'JOB_AUTOMATION_API_KEY is missing.'
      );
    }

    if (!tavilyKey) {
      throw new Error(
        'TAVILY_API_KEY is missing. Redeploy after adding the project variable.'
      );
    }

    const client =
      new Client()
        .setEndpoint(
          process.env
            .APPWRITE_FUNCTION_API_ENDPOINT
        )
        .setProject(
          process.env
            .APPWRITE_FUNCTION_PROJECT_ID
        )
        .setKey(
          appwriteKey
        );

    const tablesDB =
      new TablesDB(client);

    // ===================================================
    // LOAD JOBS
    // ===================================================

    const allJobs =
      await fetchAllJobs(
        tablesDB
      );

    // ===================================================
    // COMPANY GROUPS
    // ===================================================

    const companyMap =
      new Map();

    for (const job of allJobs) {

      const name =
        String(
          job.company_name || ''
        ).trim();

      const key =
        normalize(name);

      if (!key) {
        continue;
      }

      if (!companyMap.has(key)) {
        companyMap.set(
          key,
          {
            name,
            jobs: []
          }
        );
      }

      companyMap
        .get(key)
        .jobs
        .push(job);
    }

    const companies =
      [...companyMap.values()]
        .sort(
          (a, b) =>
            normalize(a.name)
              .localeCompare(
                normalize(b.name)
              )
        );

    // ===================================================
    // EXISTING JOB SCORE
    // ===================================================

    let existingEvaluated = 0;
    let existingPriority = 0;
    let existingWatch = 0;
    let existingBacklog = 0;
    let existingSkipped = 0;
    let existingFailed = 0;

    const companySignalCache =
      new Map();

    for (const job of allJobs) {

      try {

        if (
          job.eligibility_status ===
          'NOT_ELIGIBLE'
        ) {
          existingSkipped++;
          continue;
        }

        const companyKey =
          normalize(
            job.company_name
          );

        const company =
          companyMap.get(
            companyKey
          );

        const companyJobCount =
          company
            ? company.jobs.length
            : 1;

        const result =
          calculateExistingScore(
            job,
            companyJobCount
          );

        await tablesDB.updateRow({
          databaseId:
            DATABASE_ID,
          tableId:
            JOBS_TABLE_ID,
          rowId:
            job.$id,
          data: {
            opportunity_score:
              result.total,

            opportunity_status:
              result.status,

            opportunity_breakdown:
              JSON.stringify({
                model:
                  'existing-opportunity-v2',

                totalScore:
                  result.total,

                candidateRelevance:
                  result.candidateRelevance,

                recency:
                  result.recency,

                hiringLikelihood:
                  result.hiringLikelihood,

                companyQuality:
                  result.companyQuality,

                signalStrength:
                  result.signalStrength,

                evidenceConfidence:
                  result.evidenceConfidence,

                evaluatedAt:
                  new Date().toISOString()
              })
          }
        });

        existingEvaluated++;

        if (
          result.status ===
          'PRIORITY'
        ) {
          existingPriority++;
        } else if (
          result.status ===
          'WATCH'
        ) {
          existingWatch++;
        } else {
          existingBacklog++;
        }

      } catch (jobError) {

        existingFailed++;

        error(
          `Existing job ${job.$id}: ${jobError.message}`
        );
      }
    }

    // ===================================================
    // PROACTIVE INTELLIGENCE
    // ===================================================

    const dayNumber =
      Math.floor(
        Date.now() /
        (1000 * 60 * 60 * 24)
      );

    const startIndex =
      companies.length > 0
        ? (
            dayNumber *
            MAX_COMPANIES_PER_RUN
          ) % companies.length
        : 0;

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

    let signalSearches = 0;
    let peopleSearches = 0;
    let signalsFound = 0;
    let peopleFound = 0;
    let proactiveCreated = 0;
    let proactiveUpdated = 0;
    let proactiveErrors = 0;

    for (
      const company of companiesToCheck
    ) {

      try {

        // -------------------------------------------------
        // SIGNAL SEARCH
        // -------------------------------------------------

        const signalQuery =
          `"${company.name}" ` +
          `(expansion OR funding OR hiring OR ` +
          `"new office" OR "new business" OR ` +
          `"new vertical" OR leadership OR growth) ` +
          `India`;

        const news =
          await tavilySearch(
            tavilyKey,
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

        const signalResults =
          results
            .map(result => {

              const combined =
                [
                  result.title,
                  result.content
                ].join(' ');

              return {
                title:
                  result.title || '',

                url:
                  result.url || '',

                content:
                  result.content || '',

                publishedDate:
                  result.published_date || null,

                signalType:
                  classifySignal(
                    combined
                  )
              };
            })
            .filter(
              result =>
                Boolean(
                  result.signalType
                )
            );

        if (
          signalResults.length === 0
        ) {
          continue;
        }

        signalsFound++;

        signalResults.sort(
          (a, b) =>
            (
              daysAgo(
                a.publishedDate
              ) ?? 999
            ) -
            (
              daysAgo(
                b.publishedDate
              ) ?? 999
            )
        );

        const bestSignal =
          signalResults[0];

        const signalTypes =
          unique(
            signalResults.map(
              result =>
                result.signalType
            )
          );

        // -------------------------------------------------
        // INFER LIKELY FUNCTION
        // -------------------------------------------------

        const likelyFunction =
          inferFunction(
            [
              bestSignal.title,
              bestSignal.content
            ].join(' '),
            company.jobs
          );

        // -------------------------------------------------
        // PEOPLE SEARCH
        // -------------------------------------------------

        let people = {
          primary: null,
          secondary: null,
          candidatesFound: 0
        };

        try {

          people =
            await researchPeople(
              tavilyKey,
              company.name,
              likelyFunction
            );

          peopleSearches++;

          if (
            people.candidatesFound > 0
          ) {
            peopleFound++;
          }

        } catch (peopleError) {

          peopleSearches++;
          proactiveErrors++;

          error(
            `People research ${company.name}: ${peopleError.message}`
          );
        }

        // -------------------------------------------------
        // PROACTIVE SCORES
        // -------------------------------------------------

        let signalStrength = 0;

        for (
          const signal
          of signalResults.slice(0, 3)
        ) {

          const age =
            daysAgo(
              signal.publishedDate
            );

          if (
            age !== null &&
            age <= 7
          ) {
            signalStrength += 8;
          } else if (
            age !== null &&
            age <= 14
          ) {
            signalStrength += 6;
          } else {
            signalStrength += 4;
          }
        }

        // Diversity is additional evidence.
        signalStrength +=
          Math.min(
            signalTypes.length * 2,
            6
          );

        signalStrength =
          clamp(
            signalStrength,
            0,
            30
          );

        let companyQuality = 8;

        if (
          company.name
        ) {
          companyQuality += 4;
        }

        if (
          company.jobs.length >= 5
        ) {
          companyQuality += 8;
        } else if (
          company.jobs.length >= 3
        ) {
          companyQuality += 5;
        } else if (
          company.jobs.length >= 2
        ) {
          companyQuality += 3;
        }

        const candidateRelevance =
          proactiveCandidateRelevance(
            likelyFunction,
            company.jobs
          );

        let hiringLikelihood = 4;

        if (
          company.jobs.length >= 5
        ) {
          hiringLikelihood += 5;
        } else if (
          company.jobs.length >= 3
        ) {
          hiringLikelihood += 4;
        } else if (
          company.jobs.length >= 2
        ) {
          hiringLikelihood += 2;
        }

        if (
          signalTypes.includes(
            'HIRING'
          )
        ) {
          hiringLikelihood += 5;
        }

        if (
          signalTypes.includes(
            'EXPANSION'
          ) ||
          signalTypes.includes(
            'FUNDING'
          ) ||
          signalTypes.includes(
            'NEW_BUSINESS'
          )
        ) {
          hiringLikelihood += 2;
        }

        hiringLikelihood =
          clamp(
            hiringLikelihood,
            0,
            15
          );

        const signalAge =
          daysAgo(
            bestSignal.publishedDate
          );

        let recency = 3;

        if (
          signalAge !== null
        ) {
          if (signalAge <= 1) {
            recency = 10;
          } else if (signalAge <= 3) {
            recency = 9;
          } else if (signalAge <= 7) {
            recency = 8;
          } else if (signalAge <= 14) {
            recency = 6;
          } else if (signalAge <= 30) {
            recency = 4;
          }
        }

        let evidenceConfidence = 2;

        if (
          signalResults.length >= 2
        ) {
          evidenceConfidence++;
        }

        if (
          signalTypes.length >= 2
        ) {
          evidenceConfidence++;
        }

        if (
          people.primary ||
          people.secondary
        ) {
          evidenceConfidence++;
        }

        evidenceConfidence =
          clamp(
            evidenceConfidence,
            0,
            5
          );

        const proactiveScore =
          calculateProactiveScore({
            companyQuality,
            signalStrength,
            candidateRelevance,
            hiringLikelihood,
            recency,
            evidenceConfidence
          });

        const hasPerson =
          Boolean(
            people.primary ||
            people.secondary
          );

        const status =
          getProactiveStatus(
            proactiveScore,
            hasPerson
          );

        const currentRelevantJob =
          company.jobs.some(
            job =>
              job.eligibility_status ===
                'ELIGIBLE' ||
              job.eligibility_status ===
                'UNKNOWN'
          );

        // -------------------------------------------------
        // BUILD RECORD
        // -------------------------------------------------

        const signalEvidence = {
          detectedAt:
            new Date().toISOString(),

          bestSignal,

          additionalSignals:
            signalResults.slice(1, 5),

          signalTypes
        };

        const peopleIntelligence = {
          primary:
            people.primary,

          secondary:
            people.secondary,

          candidatesFound:
            people.candidatesFound
        };

        const scoreBreakdown = {
          model:
            'proactive-opportunity-v2',

          total:
            proactiveScore,

          companyQuality: {
            score:
              companyQuality,
            max: 20
          },

          signalStrength: {
            score:
              signalStrength,
            max: 30
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
        };

        const payload = {
          company_name:
            company.name,

          company_url:
            '',

          signal_type:
            bestSignal.signalType,

          signal_date:
            toIsoDate(
              bestSignal.publishedDate
            ) ||
            new Date().toISOString(),

          signal_source:
            'Tavily',

          signal_url:
            bestSignal.url || '',

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
            JSON.stringify(
              scoreBreakdown
            ),

          people_intelligence:
            JSON.stringify(
              peopleIntelligence
            ),

          recommended_outreach_angle:
            buildOutreachAngle(
              bestSignal.signalType,
              likelyFunction
            ),

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
              7 * 24 * 60 * 60 * 1000
            ).toISOString()
        };

        const upsertResult =
          await upsertProactive(
            tablesDB,
            payload
          );

        if (
          upsertResult ===
          'CREATED'
        ) {
          proactiveCreated++;
        } else {
          proactiveUpdated++;
        }

      } catch (companyError) {

        proactiveErrors++;

        error(
          `Proactive ${company.name}: ${companyError.message}`
        );
      }
    }

    // ===================================================
    // RESULT
    // ===================================================

    return res.json({

      status:
        proactiveErrors > 0
          ? 'PARTIAL_SUCCESS'
          : 'SUCCESS',

      existingOpportunities: {

        jobsFound:
          allJobs.length,

        evaluated:
          existingEvaluated,

        priority:
          existingPriority,

        watch:
          existingWatch,

        backlog:
          existingBacklog,

        skippedNotEligible:
          existingSkipped,

        failed:
          existingFailed
      },

      proactiveIntelligence: {

        companiesAvailable:
          companies.length,

        companiesChecked:
          companiesToCheck.length,

        signalSearches,

        peopleSearches,

        signalsFound,

        peopleFound,

        recordsCreated:
          proactiveCreated,

        recordsUpdated:
          proactiveUpdated,

        errors:
          proactiveErrors
      },

      estimatedTavilyCredits:
        signalSearches +
        peopleSearches
    });

  } catch (err) {

    error(
      `Opportunity Intelligence failed: ${err.message}`
    );

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
