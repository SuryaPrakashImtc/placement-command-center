import { Client, TablesDB, ID } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const tablesDB = new TablesDB(client);

    const job = await tablesDB.createRow({
      databaseId: '6aa03d1800119759c9bb',
      tableId: 'jobs',
      rowId: ID.unique(),
      data: {
        source: 'SYSTEM_TEST',
        job_title: 'Test Marketing Manager',
        company_name: 'Test Company',
        job_url: 'https://example.com',
        location: 'India',
        job_description: 'System connectivity test job',
        job_type: 'Full-time',
        experience_required: '0-2 years',
        education_required: 'MBA / PGDM',
        salary_range: '10+ LPA',
        work_mode: 'Hybrid',
        industry: 'Marketing',
        department: 'Marketing',
        function: 'Marketing',
        company_size: 'Unknown',
        company_type: 'Test',
        job_posted_date: new Date().toISOString(),
        application_deadline: null,
        job_status: 'TEST',
        eligibility_status: 'UNKNOWN',
        match_status: 'UNKNOWN',
        application_status: 'NOT_APPLIED',
        discovery_date: new Date().toISOString(),
        job_id: 'SYSTEM_TEST_001',
        source_job_id: 'SYSTEM_TEST_001',
        company_id: null,
        source_platform: 'SYSTEM',
        first_seen_date: new Date().toISOString(),
        last_updated_date: new Date().toISOString()
      }
    });

    return res.json({
      status: 'SUCCESS',
      message: 'Test job created successfully',
      jobId: job.$id
    });

  } catch (err) {
    error(err.message);

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
