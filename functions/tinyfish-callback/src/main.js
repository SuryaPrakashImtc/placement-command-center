import { Client, TablesDB } from "node-appwrite";

const APPWRITE_ENDPOINT =
  process.env.APPWRITE_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  "https://sgp.cloud.appwrite.io/v1";

const APPWRITE_PROJECT_ID =
  process.env.APPWRITE_PROJECT_ID ||
  process.env.APPWRITE_FUNCTION_PROJECT_ID ||
  "6aa03ac3003c12018958";

const APPWRITE_API_KEY =
  process.env.JOB_AUTOMATION_API_KEY;

const DATABASE_ID =
  process.env.APPWRITE_DATABASE_ID ||
  "6aa03d1800119759c9bb";

const JOBS_TABLE_ID =
  process.env.JOBS_TABLE_ID ||
  "jobs";

const HUMAN_INTERVENTION_STATUS =
  "HUMAN_INTERVENTION_REQUIRED";

const READY_FOR_FINAL_CONFIRMATION_STATUS =
  "READY_FOR_FINAL_CONFIRMATION";

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value) {
  return normalize(value).toLowerCase();
}

function requireEnv(name, value) {
  if (!value) {
    throw new Error("MISSING_ENV_" + name);
  }
}

function createTablesClient() {
  requireEnv(
    "JOB_AUTOMATION_API_KEY",
    APPWRITE_API_KEY
  );

  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  return new TablesDB(client);
}

function extractJobId(payload) {
  const goal =
    payload?.data?.goal ??
    payload?.goal ??
    "";

  const match =
    String(goal).match(
      /JOB_ID\s*[:=]\s*([A-Za-z0-9_-]+)/i
    );

  return match
    ? match[1]
    : "";
}

function collectRunText(payload) {
  const pieces = [
    payload?.data?.result,
    payload?.data?.error?.message,
    payload?.data?.error?.category,
    payload?.result,
    payload?.error?.message
  ];

  return pieces
    .filter(Boolean)
    .map(value =>
      typeof value === "string"
        ? value
        : JSON.stringify(value)
    )
    .join(" ")
    .toLowerCase();
}

function blockerReason(runText) {
  const rules = [
    {
      terms: [
        "captcha",
        "cloudflare",
        "verify you are human",
        "human verification",
        "turnstile",
        "recaptcha",
        "hcaptcha"
      ],
      reason:
        "Website security verification/CAPTCHA requires human intervention."
    },
    {
      terms: [
        "login required",
        "sign in required",
        "authentication required",
        "log in required"
      ],
      reason:
        "Website login/authentication requires human intervention."
    },
    {
      terms: [
        "phone verification",
        "email verification",
        "verification code"
      ],
      reason:
        "Website verification step requires human intervention."
    }
  ];

  for (const rule of rules) {
    if (
      rule.terms.some(term =>
        runText.includes(term)
      )
    ) {
      return rule.reason;
    }
  }

  return "";
}

async function getJob(tablesDB, jobId) {
  return await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: JOBS_TABLE_ID,
    rowId: jobId
  });
}

async function updateStatus(
  tablesDB,
  jobId,
  status
) {
  return await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: JOBS_TABLE_ID,
    rowId: jobId,
    data: {
      application_status: status
    }
  });
}

export default async ({ req, res, error }) => {
  /*
   * TinyFish webhooks can retry delivery.
   * Always acknowledge quickly; processing is small and idempotent.
   */
  try {
    const body =
      typeof req?.body === "object"
        ? req.body
        : JSON.parse(
            String(req?.body || "{}")
          );

    const jobId =
      normalize(
        extractJobId(body)
      );

    if (!jobId) {
      return res.json({
        status: "IGNORED",
        reason:
          "JOB_ID_NOT_FOUND_IN_TINYFISH_GOAL"
      });
    }

    const tablesDB =
      createTablesClient();

    const job =
      await getJob(
        tablesDB,
        jobId
      );

    const currentStatus =
      normalize(
        job.application_status
      ).toUpperCase();

    const runText =
      collectRunText(body);

    const blocker =
      blockerReason(
        runText
      );

    if (blocker) {
      if (
        currentStatus ===
        "SUBMITTED"
      ) {
        return res.json({
          status: "IGNORED",
          reason:
            "APPLICATION_ALREADY_SUBMITTED",
          job_id: jobId
        });
      }

      await updateStatus(
        tablesDB,
        jobId,
        HUMAN_INTERVENTION_STATUS
      );

      return res.json({
        status:
          HUMAN_INTERVENTION_STATUS,
        job_id: jobId,
        intervention_reason:
          blocker,
        next_action:
          "Resolve the website blocker manually, then resume the browser task."
      });
    }

    const event =
      lower(
        body?.event
      );

    if (
      event === "run.completed" ||
      lower(
        body?.status
      ) === "completed"
    ) {
      if (
        currentStatus !==
          "SUBMITTED" &&
        currentStatus !==
          HUMAN_INTERVENTION_STATUS
      ) {
        await updateStatus(
          tablesDB,
          jobId,
          READY_FOR_FINAL_CONFIRMATION_STATUS
        );
      }

      return res.json({
        status:
          READY_FOR_FINAL_CONFIRMATION_STATUS,
        job_id: jobId
      });
    }

    return res.json({
      status: "ACKNOWLEDGED",
      job_id: jobId
    });
  } catch (err) {
    error?.(
      err?.stack ||
      err?.message ||
      String(err)
    );

    /*
     * Return 2xx so TinyFish does not repeatedly
     * deliver malformed/non-processable callbacks.
     */
    return res.json({
      status: "ACKNOWLEDGED_WITH_ERROR"
    });
  }
};
