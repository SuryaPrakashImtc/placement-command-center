import { Client, TablesDB, ID } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const tablesDB = new TablesDB(client);

    // Fetch public remote marketing/sales jobs
    const response = await fetch(
      'https://remotive.com/api/remote-jobs?category=marketing&limit=10'
    );

    if (!response.ok) {
      throw new Error(`Remotive API returned ${response.status}`);
    }

    const data = await response.json();

    let saved = 0;

    for (const job of data.jobs) {
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
          department: job.category || 'Marketing',
          function: 'Marketing',
          company_size: 'Unknown',
          company_type: 'Unknown',
          job_posted_date: job.publication_date || null,
          application_deadline: null,
          job_status: 'OPEN',
          eligibility_status: 'UNKNOWN',
          match_status: 'UNKNOWN',
          application_status: 'NOT_APPLIED',
          discovery_date: new Date().toISOString(),
          job_id: `REMOTIVE_${job.id}`,
          source_job_id: String(job.id),
          company_id: null,
          source_platform: 'Remotive',
          first_seen_date: new Date().toISOString(),
          last_updated_date: new Date().toISOString()
        }
      });

      saved++;
    }

    return res.json({
      status: 'SUCCESS',
      source: 'Remotive',
      jobsFound: data.jobs.length,
      jobsSaved: saved
    });

  } catch (err) {
    error(err.message);

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
