import { Client, TablesDB, Query } from 'node-appwrite';

const DATABASE_ID = '6aa03d1800119759c9bb';
const TABLE_ID = 'jobs';

// =======================================================
// CANDIDATE PROFILE
// =======================================================

const candidate = {
  education: [
    'pgdm',
    'mba',
    'marketing',
    'business analytics',
    'business analytics and it',
    'bcom',
    'commerce',
    'financial accounting'
  ],

  targetFunctions: [
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
    'business analytics',
    'business analyst',
    'data analyst',
    'analytics',
    'business intelligence',
    'commercial intelligence',
    'market research',
    'consumer research',
    'insights',
    'strategy'
  ],

  skills: [
    'excel',
    'power query',
    'power pivot',
    'dax',
    'power bi',
    'tableau',
    'sql',
    'canva',
    'powerpoint',
    'presentation',
    'visual communication',
    'marketing communication',
    'stakeholder management',
    'vendor management',
    'event management',
    'lead generation',
    'prospecting',
    'market research',
    'consumer research',
    'business analysis',
    'analytics',
    'chatgpt',
    'gemini',
    'google ai studio',
    'ai'
  ],

  experience: [
    'marketing intern',
    'blue star',
    'commercial air conditioning',
    'marketing communications',
    'events',
    'exhibitions',
    'dealer engagement',
    'stakeholder management',
    'vendor coordination',
    'launch',
    'b2b',
    'prospecting',
    'lead generation'
  ],

  projects: [
    'marketing research',
    'sunscreen',
    'consumer switching',
    'purchase behaviour',
    'power bi dashboard',
    'commercial intelligence',
    'b2b prospecting',
    'client acquisition',
    'marketing audit',
    'analytics dashboard'
  ],

  fresherTerms: [
    'fresher',
    'freshers',
    'entry level',
    'entry-level',
    'graduate',
    'graduates',
    'trainee',
    'management trainee',
    'graduate trainee',
    '0-1 years',
    '0 to 1 years',
    '0 years',
    'no experience',
    'junior'
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
    .replace(/[^\w\s+#./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(text, terms) {
  return terms.some(term => text.includes(term));
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

function extractYears(text) {
  const matches = [
    ...text.matchAll(/(\d+(?:\.\d+)?)\s*\+?\s*years?/g)
  ];

  if (matches.length === 0) {
    return null;
  }

  const values = matches.map(match =>
    Number(match[1])
  );

  return Math.max(...values);
}

function determineSeniority(jobText) {
  const text = normalize(jobText);

  const seniorTerms = [
    'senior',
    'sr.',
    'lead',
    'manager',
    'head of',
    'director',
    'principal',
    'associate director',
    'vice president',
    'vp ',
    'avp',
    'regional manager'
  ];

  const juniorTerms = [
    ...candidate.fresherTerms,
    'associate',
    'executive',
    'coordinator',
    'assistant',
    'junior'
  ];

  const years = extractYears(text);

  if (
    years !== null &&
    years >= 3
  ) {
    return 'SENIOR';
  }

  if (containsAny(text, seniorTerms)) {
    return 'SENIOR';
  }

  if (containsAny(text, juniorTerms)) {
    return 'JUNIOR';
  }

  return 'UNKNOWN';
}

function getWorkModeBonus(job) {
  const mode = normalize(job.work_mode);

  if (
    mode.includes('hybrid') ||
    mode.includes('remote')
  ) {
    return 3;
  }

  return 0;
}

// =======================================================
// MATCHING ENGINE
// =======================================================

function evaluateMatch(job) {

  const title = normalize(job.job_title);

  const jobText = normalize([
    job.job_title,
    job.job_description,
    job.department,
    job.function,
    job.industry,
    job.experience_required,
    job.education_required
  ].join(' '));

  let score = 0;

  // ---------------------------------------------------
  // 1. FUNCTION / ROLE ALIGNMENT — 35
  // ---------------------------------------------------

  const functionMatches = countMatches(
    jobText,
    candidate.targetFunctions
  );

  const functionScore =
    Math.min(functionMatches, 5) * 7;

  score += functionScore;

  // ---------------------------------------------------
  // 2. SKILL ALIGNMENT — 25
  // ---------------------------------------------------

  const skillMatches = countMatches(
    jobText,
    candidate.skills
  );

  const skillScore =
    Math.min(skillMatches, 5) * 5;

  score += skillScore;

  // ---------------------------------------------------
  // 3. EDUCATION ALIGNMENT — 15
  // ---------------------------------------------------

  const educationText = normalize([
    job.job_title,
    job.job_description,
    job.education_required
  ].join(' '));

  let educationScore = 0;

  if (
    containsAny(
      educationText,
      [
        'mba',
        'pgdm',
        'management',
        'business',
        'marketing',
        'commerce',
        'bcom'
      ]
    )
  ) {
    educationScore = 15;
  } else if (
    containsAny(
      educationText,
      [
        'bachelor',
        'graduate',
        'graduation',
        'undergraduate'
      ]
    )
  ) {
    educationScore = 12;
  } else {
    educationScore = 6;
  }

  score += educationScore;

  // ---------------------------------------------------
  // 4. EXPERIENCE / SENIORITY FIT — 15
  // ---------------------------------------------------

  const seniority = determineSeniority(
    [
      title,
      job.experience_required,
      job.job_description
    ].join(' ')
  );

  let experienceScore = 0;

  if (seniority === 'JUNIOR') {
    experienceScore = 15;
  } else if (seniority === 'UNKNOWN') {
    experienceScore = 10;
  } else {
    experienceScore = 2;
  }

  score += experienceScore;

  // ---------------------------------------------------
  // 5. PRACTICAL WORK-MODE FIT — 5
  // ---------------------------------------------------

  score += Math.min(
    getWorkModeBonus(job),
    3
  );

  // ---------------------------------------------------
  // 6. BLUE STAR / B2B / ANALYTICS EXPERIENCE BONUS — 5
  // ---------------------------------------------------

  const experienceMatches = countMatches(
    jobText,
    candidate.experience
  );

  const projectMatches = countMatches(
    jobText,
    candidate.projects
  );

  if (
    experienceMatches >= 2 ||
    projectMatches >= 2
  ) {
    score += 5;
  }

  // ---------------------------------------------------
  // CAP SCORE
  // ---------------------------------------------------

  score = Math.min(score, 100);

  // ---------------------------------------------------
  // CLASSIFICATION
  // ---------------------------------------------------

  let status = 'LOW_MATCH';

  if (score >= 75) {
    status = 'HIGH_MATCH';
  } else if (score >= 55) {
    status = 'MEDIUM_MATCH';
  } else if (score >= 35) {
    status = 'LOW_MATCH';
  } else {
    status = 'NOT_A_MATCH';
  }

  return {
    score,
    status,
    seniority,
    functionMatches,
    skillMatches
  };
}

// =======================================================
// MAIN FUNCTION
// =======================================================

export default async ({ req, res, log, error }) => {

  try {

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

    const tablesDB = new TablesDB(client);

    // ---------------------------------------------------
    // FETCH JOBS NOT YET MATCHED
    // ---------------------------------------------------

    const jobsResponse =
      await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLE_ID,
        queries: [
          Query.equal(
            'match_status',
            'UNKNOWN'
          ),
          Query.limit(100)
        ]
      });

    const jobs = jobsResponse.rows || [];

    let evaluated = 0;
    let highMatch = 0;
    let mediumMatch = 0;
    let lowMatch = 0;
    let notAMatch = 0;
    let skipped = 0;
    let failed = 0;

    // ---------------------------------------------------
    // EVALUATE EACH JOB
    // ---------------------------------------------------

    for (const job of jobs) {

      try {

        // Do not match jobs already rejected
        // by the Eligibility Agent.
        if (
          job.eligibility_status ===
          'NOT_ELIGIBLE'
        ) {
          skipped++;
          continue;
        }

        const result = evaluateMatch(job);

        await tablesDB.updateRow({
          databaseId: DATABASE_ID,
          tableId: TABLE_ID,
          rowId: job.$id,
          data: {
            match_status: result.status
          }
        });

        evaluated++;

        if (
          result.status === 'HIGH_MATCH'
        ) {
          highMatch++;
        } else if (
          result.status === 'MEDIUM_MATCH'
        ) {
          mediumMatch++;
        } else if (
          result.status === 'LOW_MATCH'
        ) {
          lowMatch++;
        } else {
          notAMatch++;
        }

      } catch (jobError) {

        failed++;

        error(
          `Match failed for ${job.$id}: ${jobError.message}`
        );
      }
    }

    // ---------------------------------------------------
    // RESULT
    // ---------------------------------------------------

    return res.json({

      status: 'SUCCESS',

      jobsFoundForEvaluation:
        jobs.length,

      evaluated,

      highMatch,
      mediumMatch,
      lowMatch,
      notAMatch,

      skippedNotEligible:
        skipped,

      failed
    });

  } catch (err) {

    error(err.message);

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
