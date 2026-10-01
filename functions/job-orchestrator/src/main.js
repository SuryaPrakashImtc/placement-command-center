import { Client, TablesDB, ID, Query } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const tablesDB = new TablesDB(client);

    // =======================================================
    // HELPERS
    // =======================================================

    async function jobExists(sourceJobId) {
      const existing = await tablesDB.listRows({
        databaseId: '6aa03d1800119759c9bb',
        tableId: 'jobs',
        queries: [
          Query.equal('source_job_id', sourceJobId)
        ]
      });

      return existing.rows.length > 0;
    }

    // =======================================================
    // 1. REMOTIVE
    // =======================================================

    const remotiveCategories = [
      'marketing',
      'sales',
      'data-analysis'
    ];

    let remotiveFound = 0;
    let remotiveSaved = 0;
    let remotiveSkipped = 0;

    for (const category of remotiveCategories) {
      const response = await fetch(
        `https://remotive.com/api/remote-jobs?category=${category}&limit=10`
      );

      if (!response.ok) {
        throw new Error(
          `Remotive API returned ${response.status} for ${category}`
        );
      }

      const data = await response.json();

      remotiveFound += data.jobs.length;

      for (const job of data.jobs) {
        const sourceJobId = String(job.id);

        if (await jobExists(sourceJobId)) {
          remotiveSkipped++;
          continue;
        }

        const now = new Date().toISOString();

        await tablesDB.createRow({
          databaseId: '6aa03d1800119759c9bb',
          tableId: 'jobs',
          rowId: ID.unique(),
          data: {
            source: 'Remotive',
            job_title: job.title,
            company_name: job.company_name,
            job_url: job.url,
            location: job.candidate_required_location || 'Remote',
            job_description: job.description || '',
            job_type: job.job_type || 'Unknown',
            experience_required: 'Unknown',
            education_required: 'Unknown',
            salary_range: job.salary || 'Not disclosed',
            work_mode: 'Remote',
            industry: 'Unknown',
            department: category,
            function: category,
            company_size: 'Unknown',
            company_type: 'Unknown',
            job_posted_date: job.publication_date || null,
            application_deadline: null,
            job_status: 'OPEN',
            eligibility_status: 'UNKNOWN',
            match_status: 'UNKNOWN',
            application_status: 'NOT_APPLIED',
            discovery_date: now,
            job_id: `REMOTIVE_${sourceJobId}`,
            source_job_id: sourceJobId,
            company_id: null,
            source_platform: 'Remotive',
            first_seen_date: now,
            last_updated_date: now
          }
        });

        remotiveSaved++;
      }
    }

    // =======================================================
    // 2. HIMALAYAS
    // =======================================================

    const himalayasQueries = [
      'marketing',
      'sales',
      'business development',
      'data analyst'
    ];

    let himalayasFound = 0;
    let himalayasUnique = 0;
    let himalayasSaved = 0;
    let himalayasSkipped = 0;

    const seenHimalayasJobs = new Set();

    for (const searchTerm of himalayasQueries) {
      const url = new URL(
        'https://himalayas.app/jobs/api/search'
      );

      url.searchParams.set('q', searchTerm);
      url.searchParams.set('country', 'India');
      url.searchParams.set('sort', 'recent');
      url.searchParams.set('page', '1');

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Himalayas API returned ${response.status} for ${searchTerm}`
        );
      }

      const data = await response.json();

      himalayasFound += Array.isArray(data.jobs)
        ? data.jobs.length
        : 0;

      for (const job of data.jobs || []) {
        const guid = String(job.guid);

        if (seenHimalayasJobs.has(guid)) {
          continue;
        }

        seenHimalayasJobs.add(guid);
        himalayasUnique++;

        const sourceJobId = `HIMALAYAS_${guid}`;

        if (await jobExists(sourceJobId)) {
          himalayasSkipped++;
          continue;
        }

        const now = new Date().toISOString();

        let location = 'Worldwide';

        if (
          Array.isArray(job.locationRestrictions) &&
          job.locationRestrictions.length > 0
        ) {
          location = job.locationRestrictions
            .map(location => location.name || location.alpha2 || location)
            .filter(Boolean)
            .join(', ');
        }

        let salary = 'Not disclosed';

        if (
          job.minSalary !== null &&
          job.minSalary !== undefined
        ) {
          const min = Number(job.minSalary).toLocaleString();
          const max =
            job.maxSalary !== null &&
            job.maxSalary !== undefined
              ? Number(job.maxSalary).toLocaleString()
              : null;

          salary =
            `${job.currency || ''} ${min}` +
            (max ? ` - ${max}` : '') +
            ` ${job.salaryPeriod || 'annual'}`;
        }

        const postedDate =
          job.pubDate
            ? new Date(Number(job.pubDate)).toISOString()
            : null;

        const experience =
          Array.isArray(job.seniority) &&
          job.seniority.length > 0
            ? job.seniority.join(', ')
            : 'Unknown';

        const categories =
          Array.isArray(job.categories) &&
          job.categories.length > 0
            ? job.categories.join(', ')
            : 'Unknown';

        const parentCategories =
          Array.isArray(job.parentCategories) &&
          job.parentCategories.length > 0
            ? job.parentCategories.join(', ')
            : 'Unknown';

        await tablesDB.createRow({
          databaseId: '6aa03d1800119759c9bb',
          tableId: 'jobs',
          rowId: ID.unique(),
          data: {
            source: 'Himalayas',
            job_title: job.title || 'Unknown',
            company_name: job.companyName || 'Unknown',
            job_url: job.applicationLink || '',
            location,
            job_description:
              job.description ||
              job.excerpt ||
              '',
            job_type: job.employmentType || 'Unknown',
            experience_required: experience,
            education_required: 'Unknown',
            salary_range: salary,
            work_mode: 'Remote',
            industry: parentCategories,
            department: categories,
            function: searchTerm,
            company_size: 'Unknown',
            company_type: 'Unknown',
            job_posted_date: postedDate,
            application_deadline: null,
            job_status: 'OPEN',
            eligibility_status: 'UNKNOWN',
            match_status: 'UNKNOWN',
            application_status: 'NOT_APPLIED',
            discovery_date: now,
            job_id: sourceJobId,
            source_job_id: sourceJobId,
            company_id: null,
            source_platform: 'Himalayas',
            first_seen_date: now,
            last_updated_date: now
          }
        });

        himalayasSaved++;
      }
    }

    // =======================================================
    // 3. HOPIN
    // =======================================================

    const hopinResponse = await fetch(
      'https://api.hopinjobs.com/api/jobs'
    );

    if (!hopinResponse.ok) {
      throw new Error(
        `Hopin API returned ${hopinResponse.status}`
      );
    }

    const hopinData = await hopinResponse.json();

    const relevanceKeywords = [
      'marketing',
      'brand',
      'branding',
      'growth',
      'digital marketing',
      'product marketing',
      'sales',
      'business development',
      'account management',
      'key account',
      'inside sales',
      'pre sales',
      'presales',
      'revenue',
      'sales operations',
      'business analyst',
      'business analytics',
      'data analyst',
      'analytics',
      'business intelligence',
      'commercial intelligence',
      'marketing analytics',
      'sales analyst',
      'insights',
      'market research',
      'consumer research'
    ];

    const relevantHopinJobs = (hopinData.jobs || [])
      .filter(job => job.is_active !== false)
      .filter(job => {
        const searchableText = [
          job.title,
          job.description,
          job.industry,
          job.role_type
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return relevanceKeywords.some(keyword =>
          searchableText.includes(keyword)
        );
      })
      .sort((a, b) => {
        const aDate = a.posted_at
          ? new Date(a.posted_at).getTime()
          : 0;

        const bDate = b.posted_at
          ? new Date(b.posted_at).getTime()
          : 0;

        return bDate - aDate;
      })
      .slice(0, 150);

    let hopinFound = (hopinData.jobs || []).length;
    let hopinMatched = relevantHopinJobs.length;
    let hopinSaved = 0;
    let hopinSkipped = 0;

    for (const job of relevantHopinJobs) {
      const sourceJobId = `HOPIN_${job.id}`;

      if (await jobExists(sourceJobId)) {
        hopinSkipped++;
        continue;
      }

      const now = new Date().toISOString();

      await tablesDB.createRow({
        databaseId: '6aa03d1800119759c9bb',
        tableId: 'jobs',
        rowId: ID.unique(),
        data: {
          source: 'Hopin',
          job_title: job.title || 'Unknown',
          company_name: job.company || 'Unknown',

          // Hopin's public listing schema currently does not
          // expose an application URL.
          job_url: '',

          location: job.location || 'India',
          job_description: job.description || '',
          job_type: job.job_type || 'job',
          experience_required: 'Entry-level/Fresher',
          education_required: 'Unknown',
          salary_range:
            job.ctc_amount ||
            job.salary ||
            'Not disclosed',
          work_mode: job.work_type || 'Unknown',
          industry: job.industry || 'Unknown',
          department: job.role_type || 'Unknown',
          function: job.role_type || 'Unknown',
          company_size: 'Unknown',
          company_type: 'Unknown',
          job_posted_date: job.posted_at || null,
          application_deadline: job.deadline || null,
          job_status: job.is_active === false
            ? 'CLOSED'
            : 'OPEN',
          eligibility_status: 'UNKNOWN',
          match_status: 'UNKNOWN',
          application_status: 'NOT_APPLIED',
          discovery_date: now,
          job_id: sourceJobId,
          source_job_id: sourceJobId,
          company_id: null,
          source_platform: 'Hopin',
          first_seen_date: now,
          last_updated_date: now
        }
      });

      hopinSaved++;
    }

    // =======================================================
    // RESULT
    // =======================================================

    return res.json({
      status: 'SUCCESS',

      remotive: {
        categories: remotiveCategories,
        jobsFound: remotiveFound,
        jobsSaved: remotiveSaved,
        jobsSkippedAsDuplicate: remotiveSkipped
      },

      himalayas: {
        searchTerms: himalayasQueries,
        jobsFound: himalayasFound,
        uniqueJobs: himalayasUnique,
        jobsSaved: himalayasSaved,
        jobsSkippedAsDuplicate: himalayasSkipped
      },

      hopin: {
        jobsFound: hopinFound,
        relevantJobsMatched: hopinMatched,
        jobsProcessed: relevantHopinJobs.length,
        jobsSaved: hopinSaved,
        jobsSkippedAsDuplicate: hopinSkipped
      }
    });

  } catch (err) {
    error(err.message);

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
