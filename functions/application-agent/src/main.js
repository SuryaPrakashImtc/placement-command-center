import { Client, TablesDB, Query, Storage } from "node-appwrite";

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

const RESUME_BUCKET_ID =
  "6ac038600011e9e4bc37";

const FINAL_CV_PREFIX = "CUSTOMIZED-";

const TERMINAL_APPLICATION_STATUSES = new Set([
  "APPLIED",
  "SUBMITTED",
  "REJECTED",
  "WITHDRAWN"
]);

function requireEnv(name, value) {
  if (!value) {
    throw new Error("MISSING_ENV_" + name);
  }
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value) {
  return normalize(value).toLowerCase();
}

function isOpen(job) {
  return lower(job.job_status || job.jobStatus || "") === "open";
}

function isEligible(job) {
  const value =
    job.eligibility_status ??
    job.eligibilityStatus ??
    job.eligible;

  if (value === true) return true;

  const text = lower(value);
  return [
    "eligible",
    "yes",
    "true",
    "pass",
    "likely_eligible"
  ].includes(text);
}

function matchScore(job) {
  const raw =
    job.match_score ??
    job.matchScore ??
    job.match_percentage ??
    job.matchPercent ??
    0;

  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function isHighMatch(job) {
  const status = lower(
    job.match_status ??
    job.matchStatus ??
    ""
  );

  return (
    status === "high_match" ||
    status === "high" ||
    matchScore(job) >= 80
  );
}

function applicationStatus(job) {
  return normalize(
    job.application_status ??
    job.applicationStatus ??
    "NOT_APPLIED"
  ).toUpperCase();
}

function jobTitle(job) {
  return normalize(
    job.job_title ??
    job.jobTitle ??
    job.title ??
    ""
  );
}

function companyName(job) {
  return normalize(
    job.company_name ??
    job.companyName ??
    job.company ??
    ""
  );
}

function jobUrl(job) {
  return normalize(
    job.job_url ??
    job.jobUrl ??
    job.url ??
    ""
  );
}

function jobDescription(job) {
  return normalize(
    job.job_description ??
    job.jobDescription ??
    job.description ??
    ""
  );
}

function createClients() {
  requireEnv("JOB_AUTOMATION_API_KEY", APPWRITE_API_KEY);

  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  return {
    tablesDB: new TablesDB(client),
    storage: new Storage(client)
  };
}

async function getJobs(tablesDB) {
  const response = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: JOBS_TABLE_ID,
    queries: [
      Query.limit(100)
    ]
  });

  return response.rows || [];
}

async function getJob(tablesDB, jobId) {
  return await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: JOBS_TABLE_ID,
    rowId: jobId
  });
}

async function updateApplicationStatus(tablesDB, jobId, status) {
  return await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: JOBS_TABLE_ID,
    rowId: jobId,
    data: {
      application_status: status
    }
  });
}

async function listResumeFiles(storage) {
  const files = [];
  let offset = 0;

  while (true) {
    const page = await storage.listFiles({
      bucketId: RESUME_BUCKET_ID,
      queries: [
        Query.limit(100),
        Query.offset(offset)
      ]
    });

    const batch = page.files || [];
    files.push(...batch);

    if (batch.length < 100) {
      break;
    }

    offset += batch.length;
  }

  return files;
}

function sanitizedTokens(value) {
  return lower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findCustomizedCv(files, job) {
  const companyToken = sanitizedTokens(companyName(job));
  const titleToken = sanitizedTokens(jobTitle(job));

  const candidates = files.filter((file) => {
    const name = lower(file.name);

    if (!name.startsWith(FINAL_CV_PREFIX.toLowerCase())) {
      return false;
    }

    const companyMatches =
      !companyToken ||
      name.includes(companyToken);

    const titleMatches =
      !titleToken ||
      name.includes(titleToken);

    return companyMatches && titleMatches;
  });

  candidates.sort((a, b) => {
    const aTime = new Date(
      a.$createdAt || a.createdAt || 0
    ).getTime();

    const bTime = new Date(
      b.$createdAt || b.createdAt || 0
    ).getTime();

    return bTime - aTime;
  });

  return candidates[0] || null;
}

function selectBestJob(jobs) {
  const candidates = jobs.filter((job) => {
    const status = applicationStatus(job);

    return (
      isEligible(job) &&
      !TERMINAL_APPLICATION_STATUSES.has(status) &&
      status === "NOT_APPLIED" &&
      Boolean(jobUrl(job))
    );
  });

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => {
    const aHigh = isHighMatch(a) ? 1 : 0;
    const bHigh = isHighMatch(b) ? 1 : 0;

    if (aHigh !== bHigh) {
      return bHigh - aHigh;
    }

    const aOpen = isOpen(a) ? 1 : 0;
    const bOpen = isOpen(b) ? 1 : 0;

    if (aOpen !== bOpen) {
      return bOpen - aOpen;
    }

    return matchScore(b) - matchScore(a);
  });

  return candidates[0];
}

function buildApplicationPackage(job, cvFile, status = "READY_FOR_APPROVAL") {
  const title = jobTitle(job);
  const company = companyName(job);

  return {
    status,
    job_id: job.$id,
    company,
    job_title: title,
    job_url: jobUrl(job),
    location: normalize(job.location),
    work_mode: normalize(job.work_mode || job.workMode),
    salary_range: normalize(job.salary_range || job.salaryRange),
    match_status: normalize(job.match_status || job.matchStatus),
    match_score: matchScore(job),
    eligibility_status: normalize(
      job.eligibility_status || job.eligibilityStatus
    ),
    job_description_available: Boolean(jobDescription(job)),
    application_status: applicationStatus(job),
    customized_cv: cvFile
      ? {
          file_id: cvFile.$id,
          file_name: cvFile.name
        }
      : null,
    approval_required: true,
    submission_policy:
      "Never submit without explicit human approval."
  };
}

async function prepareApplication(tablesDB, storage, request) {
  const jobs = await getJobs(tablesDB);

  let job;

  if (request.jobId) {
    job = jobs.find(
      (item) => item.$id === String(request.jobId)
    );

    if (!job) {
      job = await getJob(
        tablesDB,
        String(request.jobId)
      );
    }
  } else {
    job = selectBestJob(jobs);
  }

  if (!job) {
    return {
      status: "NO_APPLICATION_READY"
    };
  }

  const status = applicationStatus(job);

  if (TERMINAL_APPLICATION_STATUSES.has(status)) {
    return {
      status: "APPLICATION_ALREADY_TERMINAL",
      job_id: job.$id,
      application_status: status
    };
  }

  if (!isEligible(job)) {
    return {
      status: "JOB_NOT_ELIGIBLE",
      job_id: job.$id,
      application_status: status
    };
  }

  if (!jobUrl(job)) {
    return {
      status: "APPLICATION_URL_MISSING",
      job_id: job.$id
    };
  }

  const files = await listResumeFiles(storage);
  const cvFile = findCustomizedCv(files, job);

  if (!cvFile) {
    return {
      status: "CUSTOMIZED_CV_NOT_READY",
      job_id: job.$id,
      company: companyName(job),
      job_title: jobTitle(job)
    };
  }

  return buildApplicationPackage(
    job,
    cvFile,
    "READY_FOR_APPROVAL"
  );
}

async function approveApplication(tablesDB, storage, request) {
  const jobId = normalize(request.jobId);

  if (!jobId) {
    throw new Error("JOB_ID_REQUIRED");
  }

  const job = await getJob(
    tablesDB,
    jobId
  );

  if (!isEligible(job)) {
    return {
      status: "JOB_NOT_ELIGIBLE",
      job_id: jobId
    };
  }

  if (!jobUrl(job)) {
    return {
      status: "APPLICATION_URL_MISSING",
      job_id: jobId
    };
  }

  const currentStatus = applicationStatus(job);

  if (
    currentStatus !== "NOT_APPLIED" &&
    currentStatus !== "READY_FOR_APPROVAL"
  ) {
    return {
      status: "APPLICATION_STATUS_BLOCKED",
      job_id: jobId,
      application_status: currentStatus
    };
  }

  const files = await listResumeFiles(storage);
  const cvFile = findCustomizedCv(files, job);

  if (!cvFile) {
    return {
      status: "CUSTOMIZED_CV_NOT_READY",
      job_id: jobId
    };
  }

  const updated = await updateApplicationStatus(
    tablesDB,
    jobId,
    "APPROVED_FOR_SUBMISSION"
  );

  return {
    status: "APPROVED_FOR_SUBMISSION",
    job_id: updated.$id,
    company: companyName(updated),
    job_title: jobTitle(updated),
    job_url: jobUrl(updated),
    application_status:
      applicationStatus(updated),
    customized_cv: {
      file_id: cvFile.$id,
      file_name: cvFile.name
    },
    browser_task: {
      action: "OPEN_AND_COMPLETE_APPLICATION",
      url: jobUrl(updated),
      upload_cv_file_id: cvFile.$id,
      upload_cv_file_name: cvFile.name,
      submit_only_after_human_confirmation: true
    }
  };
}

async function recordSubmission(tablesDB, request) {
  const jobId = normalize(request.jobId);

  if (!jobId) {
    throw new Error("JOB_ID_REQUIRED");
  }

  const submitted =
    request.submitted === true ||
    lower(request.submitted) === "true";

  if (!submitted) {
    return {
      status: "SUBMISSION_NOT_CONFIRMED",
      job_id: jobId
    };
  }

  const job = await getJob(
    tablesDB,
    jobId
  );

  if (
    applicationStatus(job) !==
    "APPROVED_FOR_SUBMISSION"
  ) {
    return {
      status: "SUBMISSION_BLOCKED",
      job_id: jobId,
      application_status:
        applicationStatus(job)
    };
  }

  const updated =
    await updateApplicationStatus(
      tablesDB,
      jobId,
      "SUBMITTED"
    );

  return {
    status: "SUBMITTED",
    job_id: updated.$id,
    application_status:
      applicationStatus(updated)
  };
}

export default async ({ req, res, error }) => {
  try {
    requireEnv(
      "JOB_AUTOMATION_API_KEY",
      APPWRITE_API_KEY
    );

    const request = (() => {
      if (!req?.body) return {};

      if (typeof req.body === "object") {
        return req.body;
      }

      try {
        return JSON.parse(String(req.body));
      } catch {
        throw new Error("INVALID_JSON_BODY");
      }
    })();

    const path =
      String(
        req?.path ||
        req?.url ||
        ""
      ).toLowerCase();

    const action =
      lower(
        request.action ||
        request.operation ||
        ""
      );

    const { tablesDB, storage } =
      createClients();

    if (
      action === "approve" ||
      path.includes("/approve")
    ) {
      return res.json(
        await approveApplication(
          tablesDB,
          storage,
          request
        )
      );
    }

    if (
      action === "complete" ||
      action === "submit" ||
      path.includes("/complete")
    ) {
      return res.json(
        await recordSubmission(
          tablesDB,
          request
        )
      );
    }

    return res.json(
      await prepareApplication(
        tablesDB,
        storage,
        request
      )
    );
  } catch (err) {
    error?.(err?.stack || err?.message || String(err));

    return res.json(
      {
        status: "FAILED",
        error: err?.message || String(err)
      },
      500
    );
  }
};
