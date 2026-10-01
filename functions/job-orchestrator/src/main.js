import { Client, TablesDB } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  try {
    log("Job Automation Orchestrator started");

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const tablesDB = new TablesDB(client);

    const result = await tablesDB.listRows({
      databaseId: '6aa03d1800119759c9bb',
      tableId: 'jobs'
    });

    return res.json({
      status: 'SUCCESS',
      message: 'Database connection working',
      jobsFound: result.rows.length
    });

  } catch (err) {
    error(err.message);

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
