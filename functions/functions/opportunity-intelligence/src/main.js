// Opportunity Intelligence Agent
import { Client, TablesDB, Query } from 'node-appwrite';

const DATABASE_ID = '6aa03d1800119759c9bb';
const TABLE_ID = 'jobs';

// =======================================================
// HELPERS
// =======================================================

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
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
    Date.now() - date.getTime()
  ) / (1000 * 60 * 60 * 24);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tag) {
  const regex = new RegExp(
    `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i'
  );

  const match = block.match(regex);

  return match
    ? decodeHtml(match[1])
    : '';
}

function extractNewsItems(xml) {
  const items = [];
  const blocks = xml.match(
    /<item[\s\S]*?<\/item>/gi
  ) || [];

  for (const block of blocks.slice(0, 10)) {
    const title = extractTag(block, 'title');
    const pubDate = extractTag(block, 'pubDate');
    const description = extractTag(
      block,
      'description'
    );
    const link = extractTag(block, 'link');

    if (!title) {
      continue;
    }

    items.push({
      title,
      pubDate,
      description,
      link
    });
  }

  return items;
}

function getSignalType(text) {
  const signalPatterns = [
    {
      type: 'HIRING',
      keywords: [
        'hiring',
        'recruit',
        'recruitment',
        'jobs',
        'workforce',
        'talent',
        'employees',
        'headcount'
      ]
    },
    {
      type: 'EXPANSION',
      keywords: [
        'expansion',
        'expanding',
        'new office',
        'new market',
        'entered',
        'entering',
        'launches in',
        'expands in'
      ]
    },
    {
      type: 'FUNDING',
      keywords: [
        'funding',
        'raised',
        'raises',
        'series a',
        'series b',
        'series c',
        'investment',
        'invested'
      ]
    },
    {
      type: 'GROWTH',
      keywords: [
        'growth',
        'grew',
        'revenue growth',
        'profit growth',
        'record revenue',
        'scale'
      ]
    },
    {
      type: 'LAUNCH',
      keywords: [
        'launch',
        'launched',
        'new product',
        'new business',
        'new division'
      ]
    }
  ];

  for (const signal of signalPatterns) {
    if (
      signal.keywords.some(keyword =>
        text.includes(keyword)
      )
    ) {
      return signal.type;
    }
  }

  return null;
}

// =======================================================
// GOOGLE NEWS SIGNAL RESEARCH
// =======================================================

async function getCompanySignals(companyName) {

  if (!companyName) {
    return {
      articles: [],
      signalScore: 0,
      signalTypes: [],
      confidence: 0
    };
  }

  try {

    const query =
      `"${companyName}" ` +
      `(hiring OR expansion OR funding OR growth OR jobs OR launch) ` +
      `when:14d`;

    const url = new URL(
      'https://news.google.com/rss/search'
    );

    url.searchParams.set('q', query);
    url.searchParams.set('hl', 'en-IN');
    url.searchParams.set('gl', 'IN');
    url.searchParams.set('ceid', 'IN:en');

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Placement-Command-Center/1.0'
      }
    });

    if (!response.ok) {
      return {
        articles: [],
        signalScore: 0,
        signalTypes: [],
        confidence: 0
      };
    }

    const xml = await response.text();

    const newsItems =
      extractNewsItems(xml);

    const articles = [];
    const signalTypes = new Set();

    for (const item of newsItems) {

      const combinedText =
        normalize([
          item.title,
          item.description
        ].join(' '));

      const signalType =
        getSignalType(combinedText);

      if (!signalType) {
        continue;
      }

      signalTypes.add(signalType);

      articles.push({
        title: item.title,
        published:
          item.pubDate || null,
        signal: signalType,
        link: item.link || ''
      });
    }

    // ---------------------------------------------------
    // SIGNAL SCORE — 0 to 25
    // ---------------------------------------------------

    let signalScore = 0;

    for (const article of articles) {

      const articleAge =
        daysAgo(article.published);

      let articlePoints = 3;

      if (
        articleAge !== null &&
        articleAge <= 3
      ) {
        articlePoints = 5;
      } else if (
        articleAge !== null &&
        articleAge <= 7
      ) {
        articlePoints = 4;
      }

      signalScore += articlePoints;
    }

    // Diversity of signals adds evidence.
    signalScore +=
      Math.min(signalTypes.size * 2, 6);

    signalScore =
      clamp(signalScore, 0, 25);

    return {
      articles: articles.slice(0, 5),
      signalScore,
      signalTypes: [...signalTypes],
      confidence:
        articles.length > 0
          ? 5
          : 0
    };

  } catch (err) {

    return {
      articles: [],
      signalScore: 0,
      signalTypes: [],
      confidence: 0
    };
  }
}

// =======================================================
// 4A COMPANY QUALITY — 25
// =======================================================

function calculateCompanyQuality(
  job,
  companyJobCount,
  newsSignals
) {

  let score = 0;

  const companySize =
    normalize(job.company_size);

  const companyType =
    normalize(job.company_type);

  // Explicit company size information.
  if (
    companySize &&
    companySize !== 'unknown'
  ) {
    score += 6;
  }

  // Explicit company type information.
  if (
    companyType &&
    companyType !== 'unknown'
  ) {
    score += 4;
  }

  // Multiple relevant openings indicate
  // an active/established hiring footprint.
  if (companyJobCount >= 5) {
    score += 7;
  } else if (companyJobCount >= 3) {
    score += 5;
  } else if (companyJobCount >= 2) {
    score += 3;
  }

  // Positive recent company activity.
  if (
    newsSignals.signalTypes.includes(
      'EXPANSION'
    ) ||
    newsSignals.signalTypes.includes(
      'FUNDING'
    ) ||
    newsSignals.signalTypes.includes(
      'GROWTH'
    )
  ) {
    score += 5;
  }

  // Some evidence even when the database is sparse.
  if (
    companyJobCount >= 1 ||
    newsSignals.articles.length > 0
  ) {
    score += 3;
  }

  return clamp(score, 0, 25);
}

// =======================================================
// 4B SIGNAL STRENGTH — 25
// =======================================================

function calculateSignalStrength(
  newsSignals
) {
  return clamp(
    newsSignals.signalScore,
    0,
    25
  );
}

// =======================================================
// 4C CANDIDATE RELEVANCE — 20
// =======================================================

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

// =======================================================
// 4D HIRING LIKELIHOOD — 15
// =======================================================

function calculateHiringLikelihood(
  job,
  companyJobCount,
  newsSignals
) {

  let score = 0;

  // Multiple openings = stronger hiring activity.
  if (companyJobCount >= 5) {
    score += 7;
  } else if (companyJobCount >= 3) {
    score += 5;
  } else if (companyJobCount >= 2) {
    score += 3;
  } else {
    score += 1;
  }

  // Recent hiring signal.
  if (
    newsSignals.signalTypes.includes(
      'HIRING'
    )
  ) {
    score += 5;
  }

  // Expansion/funding often indicates
  // potential hiring capacity.
  if (
    newsSignals.signalTypes.includes(
      'EXPANSION'
    ) ||
    newsSignals.signalTypes.includes(
      'FUNDING'
    )
  ) {
    score += 3;
  }

  return clamp(score, 0, 15);
}

// =======================================================
// 4E RECENCY — 10
// =======================================================

function calculateRecency(job) {

  const age =
    daysAgo(job.job_posted_date);

  if (age === null) {
    return 2;
  }

  if (age <= 1) {
    return 10;
  }

  if (age <= 3) {
    return 8;
  }

  if (age <= 7) {
    return 6;
  }

  if (age <= 14) {
    return 4;
  }

  if (age <= 30) {
    return 2;
  }

  return 0;
}

// =======================================================
// 4F EVIDENCE CONFIDENCE — 5
// =======================================================

function calculateEvidenceConfidence(
  job,
  newsSignals
) {

  let evidence = 0;

  if (
    job.job_title &&
    job.job_description
  ) {
    evidence += 1;
  }

  if (
    job.company_name &&
    job.company_name !== 'Unknown'
  ) {
    evidence += 1;
  }

  if (
    job.location &&
    job.location !== 'Unknown'
  ) {
    evidence += 1;
  }

  if (
    job.job_posted_date
  ) {
    evidence += 1;
  }

  if (
    newsSignals.articles.length > 0
  ) {
    evidence += 1;
  }

  return clamp(evidence, 0, 5);
}

// =======================================================
// STATUS
// =======================================================

function determineOpportunityStatus(
  score
) {

  if (score >= 75) {
    return 'PRIORITY';
  }

  if (score >= 55) {
    return 'WATCH';
  }

  return 'LOW_PRIORITY';
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
    // FETCH ALL JOBS
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
          tableId: TABLE_ID,
          queries
        });

      const rows =
        page.rows || [];

      allJobs.push(...rows);

      if (
        rows.length < 100
      ) {
        break;
      }

      cursor =
        rows[rows.length - 1].$id;
    }

    // ===================================================
    // COMPANY JOB COUNTS
    // ===================================================

    const companyCounts =
      new Map();

    for (const job of allJobs) {

      const company =
        normalize(job.company_name);

      if (!company) {
        continue;
      }

      companyCounts.set(
        company,
        (companyCounts.get(company) || 0) + 1
      );
    }

    // ===================================================
    // UNIQUE COMPANY NEWS CACHE
    // ===================================================

    const companyNewsCache =
      new Map();

    // ===================================================
    // PROCESS JOBS
    // ===================================================

    let evaluated = 0;
    let priority = 0;
    let watch = 0;
    let lowPriority = 0;
    let skipped = 0;
    let failed = 0;

    for (const job of allJobs) {

      try {

        // Do not score jobs rejected by eligibility.
        if (
          job.eligibility_status ===
          'NOT_ELIGIBLE'
        ) {
          skipped++;
          continue;
        }

        const companyKey =
          normalize(job.company_name);

        // -------------------------------------------------
        // COMPANY NEWS
        // -------------------------------------------------

        if (
          companyKey &&
          !companyNewsCache.has(companyKey)
        ) {

          const news =
            await getCompanySignals(
              job.company_name
            );

          companyNewsCache.set(
            companyKey,
            news
          );
        }

        const newsSignals =
          companyNewsCache.get(
            companyKey
          ) || {
            articles: [],
            signalScore: 0,
            signalTypes: [],
            confidence: 0
          };

        const companyJobCount =
          companyCounts.get(
            companyKey
          ) || 1;

        // -------------------------------------------------
        // 4A
        // -------------------------------------------------

        const companyQuality =
          calculateCompanyQuality(
            job,
            companyJobCount,
            newsSignals
          );

        // -------------------------------------------------
        // 4B
        // -------------------------------------------------

        const signalStrength =
          calculateSignalStrength(
            newsSignals
          );

        // -------------------------------------------------
        // 4C
        // -------------------------------------------------

        const candidateRelevance =
          calculateCandidateRelevance(
            job.match_status
          );

        // -------------------------------------------------
        // 4D
        // -------------------------------------------------

        const hiringLikelihood =
          calculateHiringLikelihood(
            job,
            companyJobCount,
            newsSignals
          );

        // -------------------------------------------------
        // 4E
        // -------------------------------------------------

        const recency =
          calculateRecency(job);

        // -------------------------------------------------
        // 4F
        // -------------------------------------------------

        const evidenceConfidence =
          calculateEvidenceConfidence(
            job,
            newsSignals
          );

        // -------------------------------------------------
        // TOTAL
        // -------------------------------------------------

        const totalScore = clamp(
          companyQuality +
          signalStrength +
          candidateRelevance +
          hiringLikelihood +
          recency +
          evidenceConfidence,
          0,
          100
        );

        const status =
          determineOpportunityStatus(
            totalScore
          );

        // -------------------------------------------------
        // EXPLANATION
        // -------------------------------------------------

        const breakdown = {
          totalScore,

          companyQuality: {
            score: companyQuality,
            max: 25
          },

          signalStrength: {
            score: signalStrength,
            max: 25,
            signalTypes:
              newsSignals.signalTypes
          },

          candidateRelevance: {
            score: candidateRelevance,
            max: 20,
            matchStatus:
              job.match_status
          },

          hiringLikelihood: {
            score: hiringLikelihood,
            max: 15,
            companyOpenings:
              companyJobCount
          },

          recency: {
            score: recency,
            max: 10,
            postedDate:
              job.job_posted_date
          },

          evidenceConfidence: {
            score: evidenceConfidence,
            max: 5
          },

          evidence: {
            newsArticles:
              newsSignals.articles,
            evaluatedAt:
              new Date().toISOString()
          }
        };

        await tablesDB.updateRow({
          databaseId: DATABASE_ID,
          tableId: TABLE_ID,
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
          lowPriority++;
        }

      } catch (jobError) {

        failed++;

        error(
          `Opportunity scoring failed for ${job.$id}: ${jobError.message}`
        );
      }
    }

    // ===================================================
    // RESULT
    // ===================================================

    return res.json({

      status: 'SUCCESS',

      jobsFoundForEvaluation:
        allJobs.length,

      evaluated,

      priority,
      watch,
      lowPriority,

      skippedNotEligible:
        skipped,

      uniqueCompaniesResearch:
        companyNewsCache.size,

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
