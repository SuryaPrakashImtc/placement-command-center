import { Client, TablesDB, ID, Query } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const tablesDB = new TablesDB(client);

    const categories = [
      'marketing',
      'sales',
      'data-analysis'
    ];

    let jobsFound = 0;
    let saved = 0;
    let skipped = 0;

    for (const category of categories) {

      const response = await fetch(
        `https://remotive.com/api/remote-jobs?category=${category}&limit=10`
      );

      if (!response.ok) {
        throw new Error(
          `Remotive API returned ${response.status} for ${category}`
        );
      }

      const data = await response.json();

      jobsFound += data.jobs.length;

      for (const job of data.jobs) {

        const sourceJobId = String(job.id);

        const existing = await tablesDB.listRows({
          databaseId: '6aa03d1800119759c9bb',
          tableId: 'jobs',
          queries: [
            Query.equal('source_job_id', sourceJobId)
          ]
        });

        if (existing.rows.length > 0) {
          skipped++;
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

        saved++;
      }
    }

    return res.json({
      status: 'SUCCESS',
      source: 'Remotive',
      categoriesSearched: categories,
      jobsFound,
      jobsSaved: saved,
      jobsSkippedAsDuplicate: skipped
    });

  } catch (err) {

    error(err.message);

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
