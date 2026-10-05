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
        job.industry,
        job.job_description
      ].join(' '));

      const targetRoleSignals = [
        'marketing',
        'brand',
        'branding',
        'growth',
        'digital marketing',
        'product marketing',
        'sales',
        'business development',
        'account executive',
        'account management',
        'sales development',
        'inside sales',
        'market research',
        'consumer research',
        'customer insights',
        'commercial',
        'revenue',
        'strategy',
        'business analyst',
        'business analysis',
        'marketing analyst',
        'research analyst',
        'insights analyst',
        'marketing operations',
        'sales operations',
        'category management',
        'product management',
        'management trainee',
        'graduate trainee'
      ];

      return targetRoleSignals.some(keyword =>
        text.includes(keyword)
      );
    }

    function extractMinimumYears(job) {
      const text = normalize([
        job.job_title,
        job.experience_required,
        job.job_description
      ].join(' '));

      const values = [];

      for (const match of text.matchAll(
        /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(d+(?:\.\d+)?)\s*years?/g
      )) {
        values.push(Number(match[1]));
      }

      for (const match of text.matchAll(
        /(\d+(?:\.\d+)?)\s*\+\s*years?/g
      )) {
        values.push(Number(match[1]));
      }

      for (const match of text.matchAll(
        /minimum\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*years?/g
      )) {
        values.push(Number(match[1]));
      }

      for (const match of text.matchAll(
        /(\d+(?:\.\d+)?)\s*years?\s*(?:of\s*)?experience/g
      )) {
        values.push(Number(match[1]));
      }

      if (values.length === 0) {
        return null;
      }

      return Math.min(...values);
    }

    function explicitlyWantsFresher(job) {
      const text = normalize([
        job.job_title,
        job.experience_required,
        job.job_description
      ].join(' '));

      const fresherSignals = [
        'fresher',
        'freshers',
        'entry level',
        'entry-level',
        'graduate trainee',
        'management trainee',
        '0-1 years',
        '0 to 1 years',
        '0 years',
        'no experience',
        'fresh graduate'
      ];

      return fresherSignals.some(signal =>
        text.includes(signal)
      );
    }

    function clearlyTooExperienced(job) {
      const text = normalize([
        job.job_title,
        job.experience_required,
        job.job_description
      ].join(' '));

      const seniorTitlePatterns = [
        /\bsenior\b/,
        /\bsr\.\b/,
        /\blead\b/,
        /\bmanager\b/,
        /\bhead\b/,
        /\bdirector\b/,
        /\bprincipal\b/,
        /\bvice president\b/,
        /\bavp\b/,
        /\bregional manager\b/
      ];

      if (
        seniorTitlePatterns.some(pattern =>
          pattern.test(
            normalize(job.job_title)
          )
        )
      ) {
        return true;
      }

      const minimumYears =
        extractMinimumYears(job);

      // Strict fresher gate: explicit minimum experience
      // greater than zero is not a clean fresher fit.
      if (
        minimumYears !== null &&
        minimumYears > 0
      ) {
        return true;
      }

      return false;
    }

    function clearlyTooTechnical(job) {
      const title = normalize(job.job_title);
      const text = normalize([
        job.job_title,
        job.department,
        job.function,
        job.industry,
        job.experience_required,
        job.education_required,
        job.job_description
      ].join(' '));

      const technicalRolePatterns = [
        /\bdata scientist\b/,
        /\bdata science\b/,
        /\bdata engineer\b/,
        /\bmachine learning engineer\b/,
        /\bml engineer\b/,
        /\bsoftware engineer\b/,
        /\bsoftware developer\b/,
        /\bfull.?stack\b/,
        /\bbackend developer\b/,
        /\bfrontend developer\b/,
        /\bdevops\b/,
        /\bcloud engineer\b/,
        /\bsolutions architect\b/,
        /\bdata architect\b/,
        /\bbi developer\b/,
        /\bpower bi developer\b/,
        /\betl developer\b/
      ];

      if (
        technicalRolePatterns.some(pattern =>
          pattern.test(title)
        )
      ) {
        return true;
      }

      const hardTechnicalSkills = [
        'python',
        'r programming',
        'java',
        'c++',
        'scala',
        'spark',
        'hadoop',
        'tensorflow',
        'pytorch',
        'machine learning',
        'deep learning',
        'databricks',
        'snowflake',
        'dbt',
        'airflow',
        'kubernetes',
        'docker',
        'etl',
        'sas',
        'matlab',
        'aws',
        'azure',
        'gcp'
      ];

      const technicalMatches =
        hardTechnicalSkills.filter(skill =>
          text.includes(skill)
        ).length;

      const analystLike =
        title.includes('analyst') ||
        title.includes('analytics') ||
        title.includes('business intelligence');

      return (
        analystLike &&
        technicalMatches >= 3
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

    function evaluateJob(job) {
      if (!isRelevantJob(job)) {
        return 'NOT_ELIGIBLE';
      }

      if (!isIndiaEligible(job)) {
        return hasAmbiguousLocation(job)
          ? 'UNKNOWN'
          : 'NOT_ELIGIBLE';
      }

      const salaryLpa =
        parseSalaryLpa(
          job.salary_range
        );

      if (
        salaryLpa !== null &&
        salaryLpa < 10
      ) {
        return 'NOT_ELIGIBLE';
      }

      if (clearlyTooExperienced(job)) {
        return 'NOT_ELIGIBLE';
      }

      if (clearlyTooTechnical(job)) {
        return 'NOT_ELIGIBLE';
      }

      const educationText = normalize([
        job.education_required,
        job.job_description
      ].join(' '));

      const hardDegreeExclusions = [
        'b.tech',
        'btech',
        'm.tech',
        'mtech',
        'computer science engineering',
        'computer science degree',
        'information technology degree',
        'electronics engineering',
        'mechanical engineering',
        'electrical engineering'
      ];

      const anyGraduateSignals = [
        'any graduate',
        'any degree',
        'bachelor',
        'mba',
        'pgdm',
        'commerce',
        'bcom',
        'management'
      ];

      const degreeExcluded =
        hardDegreeExclusions.some(
          signal =>
            educationText.includes(
              signal
            )
        ) &&
        !anyGraduateSignals.some(
          signal =>
            educationText.includes(
              signal
            )
        );

      if (degreeExcluded) {
        return 'NOT_ELIGIBLE';
      }

      // A role that explicitly says fresher/entry-level is a
      // strong positive signal, but absence of that wording
      // is not itself a rejection when the JD has no hard
      // experience requirement.
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
