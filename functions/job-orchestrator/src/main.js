export async function main({ req, res, log, error }) {
  log("Job Automation Orchestrator started");

  return res.json({
    status: "SUCCESS",
    message: "Job Automation Orchestrator is running",
    time: new Date().toISOString()
  });
}
