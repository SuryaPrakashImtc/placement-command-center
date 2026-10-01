import { Client, TablesDB, Query } from 'node-appwrite';

const DATABASE_ID = '6aa03d1800119759c9bb';
const TABLE_ID = 'jobs';

export default async ({ req, res, log, error }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.JOB_AUTOMATION_API_KEY);

    const tablesDB = new TablesDB(client);

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

    function isRelevantJob(job) {
      const text = normalize([
        job.job_title,
        job.department,
        job.function,
        job.industry
      ].join(' '));

      const keywords = [
        'marketing',
        'brand',
        'branding',
        'growth',
        'sales',
        'business development',
        'account',
        'commercial',
        'revenue',
        'strategy',
        'analytics',
        'analyst',
        'business intelligence',
        'business analytics',
        'data analyst',
        'insights',
        'market research',
        'consumer research'
      ];

      return keywords.some(keyword =>
        text.includes(keyword)
      );
    }

    function isIndiaEligible(job) {
      const location = normalize(job.location);
      const source = normalize(job.source);

      // Himalayas results were explicitly requested for India.
      if (source === 'himalayas') {
        return true;
      }

      // Jobicy results were filtered to India.
      if (
        source === 'jobicy' &&
        location.includes('india')
      ) {
        return true;
      }

      // "Anywhere" is not automatically India.
      if (location === 'anywhere') {
        return false;
      }

      const indiaTerms = [
        'india',
        'indian',
        'bangalore',
        'bengaluru',
        'mumbai',
        'delhi',
        'new delhi',
        'gurgaon',
        'gurugram',
        'noida',
        'hyderabad',
        'pune',
        'chennai',
        'kolkata',
        'ahmedabad',
        'jaipur',
        'nagpur'
      ];

      return indiaTerms.some(term =>
        location.includes(term)
      );
    }

    function hasAmbiguousLocation(job) {
      const location = normalize(job.location);

      if (!location) {
        return true;
      }

      if (
        location === 'remote' ||
        location === 'worldwide' ||
        location === 'global'
      ) {
        return true;
      }

      return false;
    }

    function parseSalaryLpa(value) {
      const text = normalize(value);

      if (!text || text.includes('not disclosed')) {
        return null;
      }

      // Examples:
      // 10 LPA
      // ₹10 lakh
      // INR 10 lakhs
      const lakhMatch = text.match(
        /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(?:lpa|lakh|lakhs)/
      );

      if (lakhMatch) {
        const first = Number(lakhMatch[1]);
        const second = lakhMatch[2]
          ? Number(lakhMatch[2])
          : first;

        return Math.max(first, second);
      }

      // Annual amount such as INR 900000
      const annualMatch = text.match(
        /(?:₹|rs\.?|inr)?\s*(\d[\d,]*)/
      );

      if (annualMatch) {
        const amount = Number(
          annualMatch[1].replace(/,/g, '')
        );

        if (amount >= 500000) {
          return amount / 100000;
        }
      }

      return null;
    }

    function clearlyTooExperienced(job) {
      const text = normalize([
        job.job_title,
        job.experience_required
      ].join(' '));

      // Clearly senior requirements.
      const seniorPatterns = [
        /\b3\+?\s*years?\b/,
        /\b4\+?\s*years?\b/,
        /\b5\+?\s*years?\b/,
        /\b6\+?\s*years?\b/,
        /\b7\+?\s*years?\b/,
        /\b8\+?\s*years?\b/,
        /\b9\+?\s*years?\b/,
        /\b10\+?\s*years?\b/,
        /\b3\s*-\s*\d+\s*years?\b/,
        /\b4\s*-\s*\d+\s*years?\b/,
        /\b5\s*-\s*\d+\s*years?\b/
      ];

      return seniorPatterns.some(pattern =>
        pattern.test(text)
      );
    }

    function evaluateJob(job) {
      // ---------------------------------------------------
      // HARD REJECTIONS
      // ---------------------------------------------------

      if (!isRelevantJob(job)) {
        return 'NOT_ELIGIBLE';
      }

      if (!isIndiaEligible(job)) {
        return hasAmbiguousLocation(job)
          ? 'UNKNOWN'
          : 'NOT_ELIGIBLE';
      }

      const salaryLpa = parseSalaryLpa(
        job.salary_range
      );

      // Known salary below target.
      if (
        salaryLpa !== null &&
        salaryLpa < 10
      ) {
        return 'NOT_ELIGIBLE';
      }

      // Clearly senior role.
      if (clearlyTooExperienced(job)) {
        return 'NOT_ELIGIBLE';
      }

      // ---------------------------------------------------
      // PASS INITIAL SCREEN
      // ---------------------------------------------------
      //
      // Unknown salary or experience is NOT a rejection.
      // Candidate-job matching will evaluate those later.

      return 'ELIGIBLE';
    }

    // =======================================================
    // FETCH ALL JOBS WITH CURSOR PAGINATION
    // =======================================================

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

      const page = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLE_ID,
        queries
      });

      const rows = page.rows || [];

      allJobs.push(...rows);

      if (
        rows.length < 100 ||
        !rows[rows.length - 1]
      ) {
        break;
      }

      cursor = rows[rows.length - 1].$id;
    }

    // =======================================================
    // EVALUATE
    // =======================================================

    let evaluated = 0;
    let eligible = 0;
    let notEligible = 0;
    let unknown = 0;
    let failed = 0;

    for (const job of allJobs) {
      try {

        const result = evaluateJob(job);

        await tablesDB.updateRow({
          databaseId: DATABASE_ID,
          tableId: TABLE_ID,
          rowId: job.$id,
          data: {
            eligibility_status: result
          }
        });

        evaluated++;

        if (result === 'ELIGIBLE') {
          eligible++;
        } else if (result === 'NOT_ELIGIBLE') {
          notEligible++;
        } else {
          unknown++;
        }

      } catch (jobError) {
        failed++;

        error(
          `Eligibility failed for ${job.$id}: ${jobError.message}`
        );
      }
    }

    return res.json({
      status: 'SUCCESS',
      jobsFoundForEvaluation: allJobs.length,
      evaluated,
      eligible,
      notEligible,
      unknown,
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
