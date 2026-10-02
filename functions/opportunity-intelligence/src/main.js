import {
  Client,
  TablesDB,
  Query,
  ID
} from 'node-appwrite';

const DATABASE_ID = '6aa03d1800119759c9bb';
const JOBS_TABLE_ID = 'jobs';
const PROACTIVE_TABLE_ID = '6abecc4c00069d0c8a5b';

/*
  =========================================================
  TEST SETTINGS
  =========================================================

  Start small so the normal Appwrite HTTP execution
  finishes within the 30-second synchronous limit.

  After successful testing:
  DISCOVERY_SEARCHES_PER_RUN can be increased.
  PEOPLE_RESEARCH_PER_RUN can also be increased.
*/
const DISCOVERY_SEARCHES_PER_RUN = 2;
const PEOPLE_RESEARCH_PER_RUN = 2;

const TARGET_FUNCTIONS = {
  marketing: [
    'marketing',
    'brand',
    'branding',
    'digital marketing',
    'product marketing',
    'consumer marketing',
    'marketing communications',
    'communications',
    'growth'
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
    'gtm',
    'business development'
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
    'consumer research',
    'strategy'
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function daysAgo(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return (
    Date.now() -
    date.getTime()
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

function containsAny(text, keywords) {
  const normalized = normalize(text);

  return keywords.some(
    keyword =>
      normalized.includes(
        keyword
      )
  );
}

function countMatches(text, keywords) {
  const normalized = normalize(text);

  return keywords.reduce(
    (count, keyword) =>
      count +
      (
        normalized.includes(keyword)
          ? 1
          : 0
      ),
    0
  );
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

    search_depth:
      options.searchDepth || 'basic',

    max_results:
      options.maxResults || 5,

    topic:
      options.topic || 'general',

    include_published_date:
      true,

    include_answer:
      false,

    include_raw_content:
      false
  };

  if (options.timeRange) {
    body.time_range =
      options.timeRange;
  }

  const response =
    await fetch(
      'https://api.tavily.com/search',
      {
        method: 'POST',

        headers: {
          Authorization:
            `Bearer ${apiKey}`,

          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(body)
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Tavily ${response.status}: ${responseText.slice(0, 300)}`
    );
  }

  return JSON.parse(
    responseText
  );
}


// =======================================================
// SIGNAL CLASSIFICATION
// =======================================================

function classifySignal(text) {

  const normalized =
    normalize(text);

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
        'expands into',
        'expanding into'
      ]
    },

    {
      type: 'FUNDING',

      keywords: [
        'funding',
        'raises',
        'raised',
        'raises capital',
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
        'new hires',
        'jobs',
        'team expansion'
      ]
    },

    {
      type: 'LEADERSHIP_CHANGE',

      keywords: [
        'appointed',
        'appoints',
        'appointed as',
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
        'launches',
        'launched',
        'launching'
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
        'record revenue',
        'business growth'
      ]
    }
  ];

  for (
    const rule
    of rules
  ) {

    if (
      rule.keywords.some(
        keyword =>
          normalized.includes(
            keyword
          )
      )
    ) {

      return rule.type;
    }
  }

  return null;
}


// =======================================================
// COMPANY NAME EXTRACTION
// =======================================================

function cleanCompanyName(value) {

  let company =
    String(value || '')
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  company =
    company
      .replace(
        /^['"“”]+|['"“”]+$/g,
        ''
      )
      .trim();

  company =
    company
      .replace(
        /\s+-\s+.*$/,
        ''
      )
      .trim();

  company =
    company
      .replace(
        /\s+\|\s+.*$/,
        ''
      )
      .trim();

  company =
    company
      .replace(
        /\s+–\s+.*$/,
        ''
      )
      .trim();

  return company;
}

function looksLikeCompanyName(
  value
) {

  const company =
    cleanCompanyName(
      value
    );

  if (
    !company ||
    company.length < 2 ||
    company.length > 100
  ) {
    return false;
  }

  const badValues = [
    'india',
    'global',
    'business',
    'company',
    'latest news',
    'breaking news',
    'news',
    'jobs'
  ];

  if (
    badValues.includes(
      normalize(company)
    )
  ) {
    return false;
  }

  return true;
}

function extractCompanyName(
  title,
  content
) {

  const originalTitle =
    String(title || '')
      .replace(/\s+/g, ' ')
      .trim();

  /*
    Most business-news headlines follow:
    Company raises...
    Company expands...
    Company appoints...
  */

  const headlinePatterns = [

    /^(.+?)\s+(?:raises|raised|secures|secured|announces|announced|expands|expanded|opens|opened|launches|launched|appoints|appointed|names|named|hires|hired|plans to|is hiring|begins hiring|starts hiring)\b/i,

    /^(.+?):\s+(?:raises|raised|secures|secured|announces|announced|expands|expanded|opens|opened|launches|launched|appoints|appointed|names|named|hires|hired)\b/i
  ];

  for (
    const pattern
    of headlinePatterns
  ) {

    const match =
      originalTitle.match(
        pattern
      );

    if (
      match &&
      looksLikeCompanyName(
        match[1]
      )
    ) {

      return cleanCompanyName(
        match[1]
      );
    }
  }

  /*
    Some headlines use:
    "Expansion plans of Company X..."
    "Company X: India expansion..."
  */

  const colonParts =
    originalTitle.split(':');

  if (
    colonParts.length >= 2
  ) {

    const first =
      cleanCompanyName(
        colonParts[0]
      );

    if (
      looksLikeCompanyName(
        first
      ) &&
      (
        normalize(
          colonParts[1]
        ).includes(
          'expansion'
        ) ||
        normalize(
          colonParts[1]
        ).includes(
          'hiring'
        ) ||
        normalize(
          colonParts[1]
        ).includes(
          'funding'
        ) ||
        normalize(
          colonParts[1]
        ).includes(
          'launch'
        )
      )
    ) {

      return first;
    }
  }

  /*
    Last-resort extraction from phrases such as:
    "... at Company X"
    "... by Company X"
  */

  const combined =
    `${originalTitle} ${String(
      content || ''
    )}`;

  const phraseMatches =
    combined.match(
      /(?:at|by|for|from)\s+([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,5})/g
    );

  if (
    phraseMatches &&
    phraseMatches.length > 0
  ) {

    for (
      const phrase
      of phraseMatches
    ) {

      const candidate =
        phrase
          .replace(
            /^(?:at|by|for|from)\s+/i,
            ''
          )
          .trim();

      if (
        looksLikeCompanyName(
          candidate
        )
      ) {

        return cleanCompanyName(
          candidate
        );
      }
    }
  }

  return null;
}


// =======================================================
// FUNCTION INFERENCE
// =======================================================

function inferFunction(
  signalText,
  companyJobs
) {

  const jobsText =
    normalize(
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

  const text =
    normalize(
      `${signalText} ${jobsText}`
    );

  const scores = {

    Marketing:
      countMatches(
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

  const ordered =
    Object.entries(
      scores
    ).sort(
      (a, b) =>
        b[1] - a[1]
    );

  if (
    ordered[0][1] === 0
  ) {

    return (
      'Sales / Marketing / Analytics'
    );
  }

  return ordered[0][0];
}


// =======================================================
// PEOPLE CLASSIFICATION
// =======================================================

function isHrPerson(
  text
) {

  return containsAny(
    text,
    [
      'human resources',
      'hr head',
      'head of hr',
      'head hr',
      'chief human resources',
      'chief people',
      'people head',
      'people leader',
      'talent acquisition',
      'talent acquisition head',
      'talent partner',
      'talent lead',
      'recruitment head',
      'head of talent',
      'recruiter',
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


// =======================================================
// PERSON NAME EXTRACTION
// =======================================================

function extractPersonName(
  title
) {

  let value =
    String(title || '')
      .replace(
        /\s*\|\s*LinkedIn.*$/i,
        ''
      )
      .replace(
        /\s*-\s*LinkedIn.*$/i,
        ''
      )
      .trim();

  if (
    value.includes(
      ' - '
    )
  ) {

    value =
      value
        .split(' - ')[0]
        .trim();
  }

  if (
    value.includes(
      ' | '
    )
  ) {

    value =
      value
        .split(' | ')[0]
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


// =======================================================
// PEOPLE RESEARCH
// =======================================================

async function researchPeople(
  apiKey,
  companyName,
  likelyFunction
) {

  const query =
    `"${companyName}" ` +
    `("HR Head" OR "Head of HR" OR ` +
    `"Human Resources" OR "Talent Acquisition" OR ` +
    `Recruiter OR "Head of Talent" OR ` +
    `"Head of Marketing" OR "Marketing Head" OR ` +
    `"Head of Sales" OR "Sales Head" OR ` +
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
    Array.isArray(
      data.results
    )
      ? data.results
      : [];

  const candidates = [];

  for (
    const result
    of results
  ) {

    const combined =
      [
        result.title,
        result.content
      ].join(' ');

    const normalized =
      normalize(combined);

    const hr =
      isHrPerson(
        normalized
      );

    const functional =
      isFunctionalLeader(
        normalized,
        likelyFunction
      );

    if (
      !hr &&
      !functional
    ) {
      continue;
    }

    const name =
      extractPersonName(
        result.title
      );

    if (
      name === 'Unknown'
    ) {
      continue;
    }

    candidates.push({

      name,

      title:
        result.title ||
        'Unknown',

      profileUrl:
        result.url ||
        '',

      roleType:
        hr
          ? 'HR / Talent'
          : 'Functional Leader',

      whyRelevant:
        hr
          ? 'Publicly identifiable HR/Talent professional who is closer to hiring coordination and talent decisions.'
          : `Publicly identifiable functional leader relevant to the potential ${likelyFunction} capability.`,

      evidence:
        result.content ||
        ''
    });
  }

  /*
    HR/Talent is deliberately preferred
    as the primary contact because the
    objective is early access to potential
    hiring needs.
  */

  const primary =
    candidates.find(
      person =>
        person.roleType ===
        'HR / Talent'
    ) || null;

  const secondary =
    candidates.find(
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
      candidates.length
  };
}


// =======================================================
// EXISTING JOB SCORING
// =======================================================

function calculateExistingScore(
  job,
  companyJobCount,
  companyHasSignal
) {

  // ---------------------------------------------------
  // Candidate Relevance — 40
  // ---------------------------------------------------

  let candidateRelevance = 15;

  switch (
    normalize(
      job.match_status
    )
  ) {

    case 'high_match':
      candidateRelevance = 40;
      break;

    case 'medium_match':
      candidateRelevance = 32;
      break;

    case 'low_match':
      candidateRelevance = 22;
      break;

    case 'not_a_match':
      candidateRelevance = 0;
      break;

    default:
      candidateRelevance = 15;
  }

  // ---------------------------------------------------
  // Recency — 20
  // ---------------------------------------------------

  const age =
    daysAgo(
      job.job_posted_date
    );

  let recency = 3;

  if (
    age !== null
  ) {

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

  // ---------------------------------------------------
  // Hiring Likelihood — 15
  // ---------------------------------------------------

  let hiringLikelihood = 8;

  if (
    companyJobCount >= 5
  ) {
    hiringLikelihood = 15;

  } else if (
    companyJobCount >= 3
  ) {
    hiringLikelihood = 13;

  } else if (
    companyJobCount >= 2
  ) {
    hiringLikelihood = 11;
  }

  // Live job = direct hiring evidence.
  hiringLikelihood =
    clamp(
      hiringLikelihood,
      0,
      15
    );

  // ---------------------------------------------------
  // Company Quality — 10
  // ---------------------------------------------------

  let companyQuality = 5;

  if (
    job.company_name &&
    normalize(
      job.company_name
    ) !== 'unknown'
  ) {
    companyQuality += 2;
  }

  if (
    job.company_type &&
    normalize(
      job.company_type
    ) !== 'unknown'
  ) {
    companyQuality += 1;
  }

  if (
    job.company_size &&
    normalize(
      job.company_size
    ) !== 'unknown'
  ) {
    companyQuality += 1;
  }

  if (
    companyJobCount >= 3
  ) {
    companyQuality += 1;
  }

  companyQuality =
    clamp(
      companyQuality,
      0,
      10
    );

  // ---------------------------------------------------
  // Signal Strength — 10
  // ---------------------------------------------------
  //
  // No signal is neutral.
  // Existing jobs remain viable without news.

  let signalStrength =
    companyHasSignal
      ? 10
      : 5;

  signalStrength =
    clamp(
      signalStrength,
      0,
      10
    );

  // ---------------------------------------------------
  // Evidence Confidence — 5
  // ---------------------------------------------------

  let evidenceConfidence = 2;

  if (
    job.job_title &&
    job.job_description
  ) {
    evidenceConfidence++;
  }

  if (
    job.company_name
  ) {
    evidenceConfidence++;
  }

  if (
    job.job_posted_date
  ) {
    evidenceConfidence++;
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

  /*
    A known non-match remains a backlog item.
    It is not deleted or treated as nonexistent.
  */

  let status = 'BACKLOG';

  if (
    normalize(
      job.match_status
    ) === 'not_a_match'
  ) {

    status = 'BACKLOG';

  } else if (
    total >= 65
  ) {

    status = 'PRIORITY';

  } else if (
    total >= 45
  ) {

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

  let score = 12;

  const functionText =
    normalize(
      likelyFunction
    );

  if (
    functionText.includes(
      'marketing'
    ) ||
    functionText.includes(
      'sales'
    ) ||
    functionText.includes(
      'analytics'
    )
  ) {
    score = 17;
  }

  const companyJobText =
    normalize(
      companyJobs
        .map(job => [
          job.job_title,
          job.department,
          job.function,
          job.industry
        ].join(' '))
        .join(' ')
    );

  const relevantKeywords =
    likelyFunction ===
      'Marketing'
      ? TARGET_FUNCTIONS.marketing
      : likelyFunction ===
        'Sales / Business Development'
      ? TARGET_FUNCTIONS.sales
      : TARGET_FUNCTIONS.analytics;

  if (
    containsAny(
      companyJobText,
      relevantKeywords
    )
  ) {
    score = 20;
  }

  return clamp(
    score,
    0,
    20
  );
}


// =======================================================
// PROACTIVE STATUS
// =======================================================

function getProactiveStatus(
  score,
  hasPerson
) {

  if (
    score >= 60 &&
    hasPerson
  ) {
    return 'CONTACT_READY';
  }

  if (
    score >= 40
  ) {
    return 'WATCH';
  }

  return 'SIGNAL_DETECTED';
}


// =======================================================
// OUTREACH ANGLE
// =======================================================

function buildOutreachAngle(
  signalType,
  likelyFunction
) {

  let signalAngle;

  switch (
    signalType
  ) {

    case 'EXPANSION':

      signalAngle =
        'Reference the specific expansion and demonstrate that you noticed the company movement before a role was publicly advertised.';

      break;

    case 'FUNDING':

      signalAngle =
        'Reference the funding or growth event and connect it to capabilities the company may need as it scales.';

      break;

    case 'LEADERSHIP_CHANGE':

      signalAngle =
        'Reference the leadership change and connect it thoughtfully to the capability the function may now be building.';

      break;

    case 'NEW_BUSINESS':

      signalAngle =
        'Reference the new business, product or vertical and connect it to the capabilities needed to build it.';

      break;

    case 'HIRING':

      signalAngle =
        'Reference the visible hiring activity and explore whether adjacent capability-building is underway.';

      break;

    default:

      signalAngle =
        'Reference the recent company development and connect it to the likely future capability.';
  }

  let candidateBridge;

  if (
    likelyFunction ===
    'Marketing'
  ) {

    candidateBridge =
      'Bridge this to your B2B marketing communications, commercial product launch, stakeholder, agency and event experience.';

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
      'Bridge this to your Power BI, Excel/Power Query/Power Pivot/DAX and commercial/marketing analytics experience.';

  } else {

    candidateBridge =
      'Bridge this to your combined marketing, B2B and analytics experience.';
  }

  return `${signalAngle} ${candidateBridge} Do not begin with a generic request for a job; begin with the company development and your relevant perspective.`;
}


// =======================================================
// FETCH ALL JOBS
// =======================================================

async function fetchAllJobs(
  tablesDB
) {

  let jobs = [];
  let cursor = null;

  while (true) {

    const queries = [
      Query.limit(100)
    ];

    if (cursor) {

      queries.push(
        Query.cursorAfter(
          cursor
        )
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

    jobs =
      jobs.concat(rows);

    if (
      rows.length < 100
    ) {
      break;
    }

    cursor =
      rows[
        rows.length - 1
      ].$id;
  }

  return jobs;
}


// =======================================================
// COMPANY GROUPING
// =======================================================

function groupJobsByCompany(
  jobs
) {

  const map =
    new Map();

  for (
    const job
    of jobs
  ) {

    const companyName =
      String(
        job.company_name ||
        ''
      ).trim();

    const key =
      normalize(
        companyName
      );

    if (!key) {
      continue;
    }

    if (
      !map.has(key)
    ) {

      map.set(
        key,
        {
          name:
            companyName,

          jobs: []
        }
      );
    }

    map
      .get(key)
      .jobs
      .push(job);
  }

  return map;
}


// =======================================================
// LOAD EXISTING PROACTIVE SIGNALS
// =======================================================

async function fetchExistingProactive(
  tablesDB
) {

  let rows = [];
  let cursor = null;

  while (true) {

    const queries = [
      Query.limit(100)
    ];

    if (cursor) {

      queries.push(
        Query.cursorAfter(
          cursor
        )
      );
    }

    const page =
      await tablesDB.listRows({
        databaseId:
          DATABASE_ID,

        tableId:
          PROACTIVE_TABLE_ID,

        queries
      });

    const pageRows =
      page.rows || [];

    rows =
      rows.concat(
        pageRows
      );

    if (
      pageRows.length < 100
    ) {
      break;
    }

    cursor =
      pageRows[
        pageRows.length - 1
      ].$id;
  }

  return rows;
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

    const existingRow =
      existing.rows[0];

    const originalFirstSeen =
      existingRow.first_seen_date ||
      payload.first_seen_date;

    await tablesDB.updateRow({
      databaseId:
        DATABASE_ID,

      tableId:
        PROACTIVE_TABLE_ID,

      rowId:
        existingRow.$id,

      data: {

        ...payload,

        first_seen_date:
          originalFirstSeen
      }
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
      process.env
        .JOB_AUTOMATION_API_KEY;

    const tavilyKey =
      process.env
        .TAVILY_API_KEY;

    if (!appwriteKey) {

      throw new Error(
        'JOB_AUTOMATION_API_KEY is missing.'
      );
    }

    if (!tavilyKey) {

      throw new Error(
        'TAVILY_API_KEY is missing.'
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
      new TablesDB(
        client
      );

    // ===================================================
    // LOAD DATA
    // ===================================================

    const allJobs =
      await fetchAllJobs(
        tablesDB
      );

    const companyMap =
      groupJobsByCompany(
        allJobs
      );

    const existingProactive =
      await fetchExistingProactive(
        tablesDB
      );

    // Companies that already have recent
    // proactive intelligence.
    const companiesWithSignals =
      new Set(
        existingProactive
          .map(row =>
            normalize(
              row.company_name
            )
          )
          .filter(Boolean)
      );

    // ===================================================
    // EXISTING JOB SCORING
    // ===================================================

    let existingEvaluated = 0;
    let existingPriority = 0;
    let existingWatch = 0;
    let existingBacklog = 0;
    let existingSkipped = 0;
    let existingFailed = 0;

    for (
      const job
      of allJobs
    ) {

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
            companyJobCount,
            companiesWithSignals.has(
              companyKey
            )
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
                  'existing-opportunity-v3',

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

      } catch (
        jobError
      ) {

        existingFailed++;

        error(
          `Existing job ${job.$id}: ${jobError.message}`
        );
      }
    }


    // ===================================================
    // INDEPENDENT PROACTIVE DISCOVERY
    // ===================================================

    /*
      IMPORTANT:

      These searches DO NOT start from the Jobs table.

      A company can therefore become a proactive
      opportunity even if we have never seen one of
      its jobs before.
    */

    const discoveryQueries = [

      'India company expansion funding new office new business marketing sales analytics hiring',

      'India companies hiring recruiting headcount expansion marketing sales business development analytics leadership',

      'India company new vertical new product launch growth marketing sales analytics talent',

      'India leadership appointment CMO sales head analytics head talent acquisition company growth'
    ];

    const discoveryQueriesToRun =
      discoveryQueries.slice(
        0,
        DISCOVERY_SEARCHES_PER_RUN
      );

    let discoverySearches = 0;
    let signalsFound = 0;
    let peopleSearches = 0;
    let peopleFound = 0;
    let proactiveCreated = 0;
    let proactiveUpdated = 0;
    let proactiveErrors = 0;

    const discoveredCompanies =
      new Map();

    // ---------------------------------------------------
    // SEARCH FOR EARLY SIGNALS
    // ---------------------------------------------------

    for (
      const discoveryQuery
      of discoveryQueriesToRun
    ) {

      try {

        const data =
          await tavilySearch(
            tavilyKey,
            discoveryQuery,
            {
              topic: 'news',
              timeRange: 'month',
              maxResults: 5
            }
          );

        discoverySearches++;

        const results =
          Array.isArray(
            data.results
          )
            ? data.results
            : [];

        for (
          const result
          of results
        ) {

          const combined =
            [
              result.title,
              result.content
            ].join(' ');

          const signalType =
            classifySignal(
              combined
            );

          if (!signalType) {
            continue;
          }

          const companyName =
            extractCompanyName(
              result.title,
              result.content
            );

          /*
            Do not fabricate a company name.
            If the headline is too ambiguous,
            ignore that result.
          */

          if (!companyName) {
            continue;
          }

          const companyKey =
            normalize(
              companyName
            );

          if (
            !discoveredCompanies.has(
              companyKey
            )
          ) {

            discoveredCompanies.set(
              companyKey,
              {
                companyName,
                signals: []
              }
            );
          }

          discoveredCompanies
            .get(companyKey)
            .signals
            .push({

              title:
                result.title ||
                '',

              url:
                result.url ||
                '',

              content:
                result.content ||
                '',

              publishedDate:
                result.published_date ||
                null,

              signalType
            });
        }

      } catch (
        discoveryError
      ) {

        proactiveErrors++;

        error(
          `Discovery search failed: ${discoveryError.message}`
        );
      }
    }

    // ---------------------------------------------------
    // SORT DISCOVERED COMPANIES
    // ---------------------------------------------------

    const discoveredList =
      [...discoveredCompanies.values()]
        .map(company => {

          const signals =
            company.signals;

          signals.sort(
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

          return {
            ...company,

            signals,

            strongestSignal:
              signals[0]
          };
        })
        .filter(
          company =>
            company.strongestSignal
        );

    // ===================================================
    // PREPARE EXISTING PROACTIVE RECORDS
    // ===================================================

    /*
      Existing proactive rows without a person are also
      candidates for people research.

      This prevents a good signal from disappearing just
      because we could not identify the right person on
      its first scan.
    */

    const peopleFollowUps = [];

    for (
      const row
      of existingProactive
    ) {

      let peopleData = null;

      try {

        peopleData =
          JSON.parse(
            row.people_intelligence ||
            '{}'
          );

      } catch {
        peopleData = {};
      }

      const hasPerson =
        Boolean(
          peopleData?.primary ||
          peopleData?.secondary
        );

      const nextCheck =
        row.next_check_date
          ? new Date(
              row.next_check_date
            ).getTime()
          : 0;

      if (
        !hasPerson &&
        (
          !nextCheck ||
          nextCheck <= Date.now()
        )
      ) {

        peopleFollowUps.push({
          companyName:
            row.company_name,

          likelyFunction:
            row.likely_function,

          signalType:
            row.signal_type,

          row
        });
      }
    }


    // ===================================================
    // PROCESS NEW SIGNALS
    // ===================================================

    /*
      We create every credible signal.

      We only do intensive people research for a
      limited number of the strongest candidates during
      the test.
    */

    const scoredCompanies =
      discoveredList.map(
        company => {

          const companyJobs =
            companyMap.get(
              normalize(
                company.companyName
              )
            )?.jobs || [];

          const likelyFunction =
            inferFunction(
              company.signals
                .map(signal => [
                  signal.title,
                  signal.content
                ].join(' '))
                .join(' '),
              companyJobs
            );

          const signalTypes =
            unique(
              company.signals.map(
                signal =>
                  signal.signalType
              )
            );

          return {
            ...company,

            companyJobs,

            likelyFunction,

            signalTypes
          };
        }
      );

    // ---------------------------------------------------
    // PRE-RESEARCH SCORE
    // ---------------------------------------------------

    for (
      const company
      of scoredCompanies
    ) {

      const companyJobs =
        company.companyJobs;

      const signals =
        company.signals;

      // 4A Company Quality — 20
      let companyQuality = 8;

      if (
        company.companyName
      ) {
        companyQuality += 3;
      }

      if (
        companyJobs.length >= 5
      ) {
        companyQuality += 8;

      } else if (
        companyJobs.length >= 3
      ) {
        companyQuality += 5;

      } else if (
        companyJobs.length >= 2
      ) {
        companyQuality += 3;
      }

      companyQuality =
        clamp(
          companyQuality,
          0,
          20
        );

      // 4B Signal Strength — 30
      let signalStrength = 0;

      for (
        const signal
        of signals.slice(0, 4)
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

      signalStrength +=
        Math.min(
          company.signalTypes.length * 3,
          9
        );

      signalStrength =
        clamp(
          signalStrength,
          0,
          30
        );

      // 4C Candidate Relevance — 20
      const candidateRelevance =
        proactiveCandidateRelevance(
          company.likelyFunction,
          companyJobs
        );

      // 4D Hiring Likelihood — 15
      let hiringLikelihood = 4;

      if (
        companyJobs.length >= 5
      ) {
        hiringLikelihood += 5;

      } else if (
        companyJobs.length >= 3
      ) {
        hiringLikelihood += 4;

      } else if (
        companyJobs.length >= 2
      ) {
        hiringLikelihood += 2;
      }

      if (
        company.signalTypes.includes(
          'HIRING'
        )
      ) {
        hiringLikelihood += 5;
      }

      if (
        company.signalTypes.includes(
          'EXPANSION'
        ) ||
        company.signalTypes.includes(
          'FUNDING'
        ) ||
        company.signalTypes.includes(
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

      // 4E Recency — 10
      const strongestSignal =
        company.strongestSignal;

      const signalAge =
        daysAgo(
          strongestSignal.publishedDate
        );

      let recency = 3;

      if (
        signalAge !== null
      ) {

        if (
          signalAge <= 1
        ) {
          recency = 10;

        } else if (
          signalAge <= 3
        ) {
          recency = 9;

        } else if (
          signalAge <= 7
        ) {
          recency = 8;

        } else if (
          signalAge <= 14
        ) {
          recency = 6;

        } else if (
          signalAge <= 30
        ) {
          recency = 4;
        }
      }

      // 4F Evidence Confidence — 5
      let evidenceConfidence = 2;

      if (
        signals.length >= 2
      ) {
        evidenceConfidence++;
      }

      if (
        company.signalTypes.length >= 2
      ) {
        evidenceConfidence++;
      }

      /*
        A person will add the fifth point later.
      */

      evidenceConfidence =
        clamp(
          evidenceConfidence,
          0,
          5
        );

      const proactiveScore =
        clamp(
          companyQuality +
          signalStrength +
          candidateRelevance +
          hiringLikelihood +
          recency +
          evidenceConfidence,
          0,
          100
        );

      const currentRelevantJob =
        companyJobs.some(
          job =>
            job.eligibility_status ===
              'ELIGIBLE' ||
            job.eligibility_status ===
              'UNKNOWN'
        );

      company.preScore =
        proactiveScore;

      company.companyQuality =
        companyQuality;

      company.signalStrength =
        signalStrength;

      company.candidateRelevance =
        candidateRelevance;

      company.hiringLikelihood =
        hiringLikelihood;

      company.recency =
        recency;

      company.evidenceConfidence =
        evidenceConfidence;

      company.currentRelevantJob =
        currentRelevantJob;
    }

    // Strongest signals get person research first.
    scoredCompanies.sort(
      (a, b) =>
        b.preScore -
        a.preScore
    );

    const peopleResearchTargets =
      scoredCompanies.slice(
        0,
        PEOPLE_RESEARCH_PER_RUN
      );

    const peopleResearchNames =
      new Set(
        peopleResearchTargets.map(
          company =>
            normalize(
              company.companyName
            )
        )
      );

    // ===================================================
    // PEOPLE RESEARCH FOR NEW SIGNALS
    // ===================================================

    for (
      const company
      of scoredCompanies
    ) {

      if (
        !peopleResearchNames.has(
          normalize(
            company.companyName
          )
        )
      ) {
        continue;
      }

      try {

        const people =
          await researchPeople(
            tavilyKey,
            company.companyName,
            company.likelyFunction
          );

        peopleSearches++;

        if (
          people.candidatesFound > 0
        ) {
          peopleFound++;
        }

        company.people =
          people;

      } catch (
        peopleError
      ) {

        peopleSearches++;

        proactiveErrors++;

        error(
          `People research failed for ${company.companyName}: ${peopleError.message}`
        );

        company.people = {
          primary: null,
          secondary: null,
          candidatesFound: 0
        };
      }
    }

    // ===================================================
    // SAVE NEW PROACTIVE SIGNALS
    // ===================================================

    for (
      const company
      of scoredCompanies
    ) {

      try {

        signalsFound++;

        const strongestSignal =
          company.strongestSignal;

        const people =
          company.people || {
            primary: null,
            secondary: null,
            candidatesFound: 0
          };

        /*
          People research adds evidence confidence.
        */

        let finalEvidenceConfidence =
          company.evidenceConfidence;

        if (
          people.primary ||
          people.secondary
        ) {
          finalEvidenceConfidence = 5;
        }

        const finalScore =
          clamp(
            company.companyQuality +
            company.signalStrength +
            company.candidateRelevance +
            company.hiringLikelihood +
            company.recency +
            finalEvidenceConfidence,
            0,
            100
          );

        const hasPerson =
          Boolean(
            people.primary ||
            people.secondary
          );

        const status =
          getProactiveStatus(
            finalScore,
            hasPerson
          );

        const signalEvidence = {

          detectedAt:
            new Date().toISOString(),

          bestSignal:
            strongestSignal,

          additionalSignals:
            company.signals.slice(
              1,
              5
            ),

          signalTypes:
            company.signalTypes
        };

        const peopleIntelligence = {

          primary:
            people.primary,

          secondary:
            people.secondary,

          candidatesFound:
            people.candidatesFound,

          researchedAt:
            peopleSearchNamesHas(
              peopleResearchNames,
              company.companyName
            )
              ? new Date().toISOString()
              : null
        };

        const scoreBreakdown = {

          model:
            'proactive-opportunity-v3',

          total:
            finalScore,

          companyQuality: {
            score:
              company.companyQuality,
            max: 20
          },

          signalStrength: {
            score:
              company.signalStrength,
            max: 30
          },

          candidateRelevance: {
            score:
              company.candidateRelevance,
            max: 20
          },

          hiringLikelihood: {
            score:
              company.hiringLikelihood,
            max: 15
          },

          recency: {
            score:
              company.recency,
            max: 10
          },

          evidenceConfidence: {
            score:
              finalEvidenceConfidence,
            max: 5
          }
        };

        const nextCheckDays =
          hasPerson
            ? 7
            : 3;

        const payload = {

          company_name:
            company.companyName,

          company_url:
            null,

          signal_type:
            strongestSignal.signalType,

          signal_date:
            toIsoDate(
              strongestSignal.publishedDate
            ) ||
            new Date().toISOString(),

          signal_source:
            'Tavily',

          signal_url:
            strongestSignal.url ||
            null,

          signal_evidence:
            JSON.stringify(
              signalEvidence
            ),

          likely_function:
            company.likelyFunction,

          likely_role_area:
            `${company.likelyFunction} capability build`,

          current_relevant_job_found:
            company.currentRelevantJob,

          proactive_score:
            finalScore,

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
              strongestSignal.signalType,
              company.likelyFunction
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
              nextCheckDays *
              24 *
              60 *
              60 *
              1000
            ).toISOString()
        };

        const result =
          await upsertProactive(
            tablesDB,
            payload
          );

        if (
          result === 'CREATED'
        ) {
          proactiveCreated++;

        } else {
          proactiveUpdated++;
        }

      } catch (
        proactiveError
      ) {

        proactiveErrors++;

        error(
          `Proactive save failed for ${company.companyName}: ${proactiveError.message}`
        );
      }
    }


    // ===================================================
    // PEOPLE FOLLOW-UP
    // ===================================================

    /*
      Research up to the remaining capacity for older
      proactive records that still lack a person.

      This keeps the people layer persistent rather than
      depending only on finding someone on the first scan.
    */

    const remainingCapacity =
      Math.max(
        PEOPLE_RESEARCH_PER_RUN -
        peopleResearchTargets.length,
        0
      );

    const followUps =
      peopleFollowUps.slice(
        0,
        remainingCapacity
      );

    for (
      const followUp
      of followUps
    ) {

      try {

        const people =
          await researchPeople(
            tavilyKey,
            followUp.companyName,
            followUp.likelyFunction
          );

        peopleSearches++;

        if (
          people.candidatesFound > 0
        ) {
          peopleFound++;
        }

        const currentRow =
          followUp.row;

        let currentBreakdown =
          {};

        try {

          currentBreakdown =
            JSON.parse(
              currentRow.score_breakdown ||
              '{}'
            );

        } catch {
          currentBreakdown =
            {};
        }

        const hasPerson =
          Boolean(
            people.primary ||
            people.secondary
          );

        const oldScore =
          Number(
            currentRow.proactive_score
          ) || 0;

        const updatedConfidence =
          hasPerson
            ? 5
            : Number(
                currentBreakdown
                  ?.evidenceConfidence
                  ?.score
              ) || 2;

        /*
          Add only the evidence-confidence improvement
          from finding a person.
        */

        const updatedScore =
          clamp(
            oldScore -
            (
              Number(
                currentBreakdown
                  ?.evidenceConfidence
                  ?.score
              ) || 0
            ) +
            updatedConfidence,
            0,
            100
          );

        const updatedStatus =
          getProactiveStatus(
            updatedScore,
            hasPerson
          );

        await tablesDB.updateRow({

          databaseId:
            DATABASE_ID,

          tableId:
            PROACTIVE_TABLE_ID,

          rowId:
            currentRow.$id,

          data: {

            proactive_score:
              updatedScore,

            proactive_status:
              updatedStatus,

            people_intelligence:
              JSON.stringify({
                primary:
                  people.primary,

                secondary:
                  people.secondary,

                candidatesFound:
                  people.candidatesFound,

                researchedAt:
                  new Date().toISOString()
              }),

            recommended_outreach_angle:
              buildOutreachAngle(
                followUp.signalType,
                followUp.likelyFunction
              ),

            last_checked_date:
              new Date().toISOString(),

            next_check_date:
              new Date(
                Date.now() +
                (
                  hasPerson
                    ? 7
                    : 3
                ) *
                24 *
                60 *
                60 *
                1000
              ).toISOString()
          }
        });

      } catch (
        followUpError
      ) {

        peopleSearches++;

        proactiveErrors++;

        error(
          `Proactive people follow-up failed for ${followUp.companyName}: ${followUpError.message}`
        );
      }
    }


    // ===================================================
    // FINAL RESULT
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

        discoverySearches,

        discoveryResultsCompanies:
          discoveredCompanies.size,

        signalsFound,

        peopleSearches,

        peopleFound,

        recordsCreated:
          proactiveCreated,

        recordsUpdated:
          proactiveUpdated,

        errors:
          proactiveErrors,

        independentCompanyDiscovery:
          true
      },

      estimatedTavilyCredits:
        discoverySearches +
        peopleSearches
    });

  } catch (
    err
  ) {

    error(
      `Opportunity Intelligence failed: ${err.message}`
    );

    return res.json({

      status:
        'FAILED',

      error:
        err.message
    }, 500);
  }
};


// =======================================================
// SMALL HELPER
// =======================================================

function peopleSearchNamesHas(
  set,
  companyName
) {

  return set.has(
    normalize(
      companyName
    )
  );
}
