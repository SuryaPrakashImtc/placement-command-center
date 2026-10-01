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

    const eligibilityRules = {
      allowedFunctions: [
        'marketing',
        'sales',
        'business development',
        'business analytics',
        'data analyst',
        'analytics',
        'business intelligence',
        'commercial intelligence',
        'market research',
        'consumer research',
        'growth',
        'brand',
        'strategy',
        'account management',
        'sales operations',
        'revenue'
      ],

      fresherKeywords: [
        'fresher',
        'freshers',
        'entry level',
        'entry-level',
        'graduate',
        'graduates',
        '0-1 years',
        '0 to 1 years',
        '0 years',
        'no experience',
        'intern to full time',
        'management trainee',
        'graduate trainee',
        'trainee'
      ],

      experienceRejectionPatterns: [
        '5+ years',
        '6+ years',
        '7+ years',
        '8+ years',
        '9+ years',
        '10+ years',
        '5 years',
        '6 years',
        '7 years',
        '8 years',
        '9 years',
        '10 years'
      ]
    };

    function normalize(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function parseSalaryLpa(salaryText) {
      const text = normalize(salaryText);

      if (
        !text ||
        text.includes('not disclosed') ||
        text.includes('unknown')
      ) {
        return null;
      }

      // ₹10 LPA / INR 10 lakh / 10 lakhs
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

      // ₹1,000,000 / INR 1000000 etc.
      const annualMatch = text.match(
        /(?:₹|rs\.?|inr)?\s*(\d[\d,]*)/
      );

      if (annualMatch) {
        const annualValue = Number(
          annualMatch[1].replace(/,/g, '')
        );

        if (annualValue >= 500000) {
          return annualValue / 100000;
        }
      }

      return null;
    }

    function isIndiaRelevant(job) {
      const location = normalize(job.location);

      if (!location) {
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
        'nagpur',
        'remote'
      ];

      return indiaTerms.some(term =>
        location.includes(term)
      );
    }

    function isRelevantFunction(job) {
      const text = normalize([
        job.job_title,
        job.department,
        job.function,
        job.industry,
        job.job_description
      ].join(' '));

      return eligibilityRules.allowedFunctions.some(
        keyword => text.includes(keyword)
      );
    }

    function isClearlyFresherFriendly(job) {
      const text = normalize([
        job.job_title,
        job.experience_required,
        job.job_description
      ].join(' '));

      return eligibilityRules.fresherKeywords.some(
        keyword => text.includes(keyword)
      );
    }

    function isClearlyTooExperienced(job) {
      const text = normalize([
        job.experience_required,
        job.job_description
      ].join(' '));

      return eligibilityRules.experienceRejectionPatterns.some(
        pattern => text.includes(pattern)
      );
    }

    function evaluateJob(job) {
      const indiaRelevant = isIndiaRelevant(job);
      const relevantFunction = isRelevantFunction(job);
      const fresherFriendly = isClearlyFresherFriendly(job);
      const tooExperienced = isClearlyTooExperienced(job);

      const salaryLpa = parseSalaryLpa(
        job.salary_range
      );

      // Hard rejection: wrong geography.
      if (!indiaRelevant) {
        return 'NOT_ELIGIBLE';
      }

      // Hard rejection: clearly unrelated function.
      if (!relevantFunction) {
        return 'NOT_ELIGIBLE';
      }

      // Hard rejection: clearly senior role.
      if (tooExperienced && !fresherFriendly) {
        return 'NOT_ELIGIBLE';
      }

      // Known salary below target.
      if (
        salaryLpa !== null &&
        salaryLpa < 10
      ) {
        return 'NOT_ELIGIBLE';
      }

      // Known salary meeting target + relevant role.
      if (
        salaryLpa !== null &&
        salaryLpa >= 10
      ) {
        return 'ELIGIBLE';
      }

      // Explicitly fresher-friendly but salary unknown.
      if (fresherFriendly) {
        return 'ELIGIBLE';
      }

      // Relevant + India, but critical information is missing.
      return 'UNKNOWN';
    }

    // Fetch jobs whose eligibility has not been evaluated.
    const jobsResponse = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLE_ID,
      queries: [
        Query.equal('eligibility_status', 'UNKNOWN'),
        Query.limit(100)
      ]
    });

    const jobs = jobsResponse.rows || [];

    let evaluated = 0;
    let eligible = 0;
    let notEligible = 0;
    let unknown = 0;
    let failed = 0;

    for (const job of jobs) {
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
      jobsFoundForEvaluation: jobs.length,
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
