import { Client, Query, Storage, TablesDB, Tokens } from "node-appwrite";

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

const PROACTIVE_TABLE_ID =
  "6abecc4c00069d0c8a5b";

const RESUME_BUCKET_ID =
  "6ac038600011e9e4bc37";

const FINAL_CV_PREFIX =
  "CUSTOMIZED-";

const PENDING_CV_PREFIX =
  "PENDING-CUSTOMIZED-";

const DASHBOARD_ORIGIN =
  "*";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    DASHBOARD_ORIGIN,
  "Access-Control-Allow-Methods":
    "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Vary":
    "Origin"
};

function respond(res, data, status = 200) {
  return res.json(
    data,
    status,
    CORS_HEADERS
  );
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value) {
  return normalize(value).toLowerCase();
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isEligible(job) {
  const value =
    job.eligibility_status ??
    job.eligibilityStatus ??
    job.eligible;

  if (value === true) return true;

  return [
    "eligible",
    "yes",
    "true",
    "pass",
    "likely_eligible"
  ].includes(lower(value));
}

function matchScore(job) {
  return numberValue(
    job.match_score ??
    job.matchScore ??
    job.match_percentage ??
    job.matchPercent
  );
}

function opportunityScore(job) {
  return numberValue(
    job.opportunity_score ??
    job.opportunityScore
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
    job.title
  );
}

function companyName(job) {
  return normalize(
    job.company_name ??
    job.companyName ??
    job.company
  );
}

function jobUrl(job) {
  return normalize(
    job.job_url ??
    job.jobUrl ??
    job.url
  );
}

function createdTime(row) {
  return new Date(
    row.$createdAt ||
    row.createdAt ||
    0
  ).getTime() || 0;
}

async function listAllRows(tablesDB, tableId) {
  const rows = [];
  let cursor = null;

  while (true) {
    const queries = [
      Query.limit(100)
    ];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const page =
      await tablesDB.listRows({
        databaseId:
          DATABASE_ID,
        tableId,
        queries
      });

    const batch =
      page.rows || [];

    rows.push(...batch);

    if (batch.length < 100) {
      break;
    }

    cursor =
      batch[batch.length - 1].$id;

    if (!cursor) {
      break;
    }
  }

  return rows;
}

async function listResumeFiles(storage) {
  const files = [];
  let offset = 0;

  while (true) {
    const page =
      await storage.listFiles({
        bucketId:
          RESUME_BUCKET_ID,
        queries: [
          Query.limit(100),
          Query.offset(offset)
        ]
      });

    const batch =
      page.files || [];

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

function hasCustomizedCv(files, job) {
  const company =
    sanitizedTokens(
      companyName(job)
    );

  const title =
    sanitizedTokens(
      jobTitle(job)
    );

  return files.some(
    file => {
      const name =
        lower(file.name);

      return (
        name.startsWith(
          FINAL_CV_PREFIX.toLowerCase()
        ) &&
        (!company ||
          name.includes(company)) &&
        (!title ||
          name.includes(title))
      );
    }
  );
}

function compactJob(job, cvReady) {
  return {
    id: job.$id,
    title: jobTitle(job),
    company: companyName(job),
    source:
      normalize(
        job.source_platform ||
        job.source
      ),
    location:
      normalize(job.location),
    work_mode:
      normalize(
        job.work_mode ||
        job.workMode
      ),
    salary:
      normalize(
        job.salary_range ||
        job.salaryRange
      ),
    url:
      jobUrl(job),
    eligibility_status:
      normalize(
        job.eligibility_status
      ),
    match_status:
      normalize(
        job.match_status
      ),
    match_score:
      matchScore(job),
    opportunity_status:
      normalize(
        job.opportunity_status
      ),
    opportunity_score:
      opportunityScore(job),
    application_status:
      applicationStatus(job),
    customized_cv_ready:
      cvReady,
    posted_at:
      job.job_posted_date ||
      job.jobPostedDate ||
      null
  };
}

function cvFileKind(name) {
  const n = lower(name);
  if (n === "master cv fp.docx") {
    return "MASTER";
  }
  if (n.startsWith(FINAL_CV_PREFIX.toLowerCase())) {
    return "CUSTOMIZED";
  }
  if (n.startsWith(PENDING_CV_PREFIX.toLowerCase())) {
    return "PENDING";
  }
  return "OTHER";
}

function parseCustomizedCvName(name) {
  const raw = normalize(name)
    .replace(/^customized-/i, "")
    .replace(/\.docx$/i, "");

  const stampIndex =
    raw.search(
      /-\d{4}-\d{2}-\d{2}t/i
    );

  const withoutStamp =
    stampIndex >= 0
      ? raw.slice(0, stampIndex)
      : raw;

  const parts =
    withoutStamp.split("-");

  if (parts.length < 2) {
    return {
      company: withoutStamp,
      role: ""
    };
  }

  const company =
    parts
      .slice(0, -1)
      .join(" ");

  const role =
    parts[parts.length - 1];

  return {
    company,
    role
  };
}

function compactOpportunity(row) {
  return {
    id: row.$id,
    company:
      normalize(row.company_name),
    likely_function:
      normalize(row.likely_function),
    score:
      numberValue(
        row.proactive_score ??
        row.opportunity_score
      ),
    status:
      normalize(
        row.proactive_status ??
        row.opportunity_status
      ),
    signal_type:
      normalize(row.signal_type),
    outreach_angle:
      normalize(
        row.recommended_outreach_angle
      ),
    approval_status:
      normalize(row.approval_status),
    outreach_status:
      normalize(row.outreach_status),
    next_check_date:
      row.next_check_date ||
      null
  };
}

function countBy(rows, fn) {
  const counts = {};
  for (const row of rows) {
    const key = fn(row) || "UNKNOWN";
    counts[key] =
      (counts[key] || 0) + 1;
  }
  return counts;
}

export default async ({ req, res, error }) => {
  try {
    if (String(req?.method || "").toUpperCase() === "OPTIONS") {
      return res.text("", 204, CORS_HEADERS);
    }

    if (!APPWRITE_API_KEY) {
      throw new Error(
        "JOB_AUTOMATION_API_KEY is missing."
      );
    }

    const client =
      new Client()
        .setEndpoint(
          APPWRITE_ENDPOINT
        )
        .setProject(
          APPWRITE_PROJECT_ID
        )
        .setKey(
          APPWRITE_API_KEY
        );

    const tablesDB =
      new TablesDB(client);

    const storage =
      new Storage(client);

    const tokens =
      new Tokens(client);

    const jobs =
      await listAllRows(
        tablesDB,
        JOBS_TABLE_ID
      );

    const proactiveRows =
      await listAllRows(
        tablesDB,
        PROACTIVE_TABLE_ID
      );

    const resumeFiles =
      await listResumeFiles(
        storage
      );

    const cvFiles =
      [];

    for (const file of resumeFiles) {
      const kind =
        cvFileKind(file.name);

      if (
        ![
          "MASTER",
          "CUSTOMIZED",
          "PENDING"
        ].includes(kind)
      ) {
        continue;
      }

      let downloadUrl = null;

      try {
        const expire =
          new Date(
            Date.now() +
            20 * 60 * 1000
          ).toISOString();

        const token =
          await tokens.createFileToken({
            bucketId:
              RESUME_BUCKET_ID,
            fileId:
              file.$id,
            expire
          });

        downloadUrl =
          APPWRITE_ENDPOINT +
          "/storage/buckets/" +
          encodeURIComponent(
            RESUME_BUCKET_ID
          ) +
          "/files/" +
          encodeURIComponent(
            file.$id
          ) +
          "/download?project=" +
          encodeURIComponent(
            APPWRITE_PROJECT_ID
          ) +
          "&token=" +
          encodeURIComponent(
            token.secret
          );
      } catch {
        downloadUrl = null;
      }

      const parsed =
        kind === "CUSTOMIZED"
          ? parseCustomizedCvName(
              file.name
            )
          : {
              company:
                kind === "MASTER"
                  ? "Master CV"
                  : "Pending validation",
              role: ""
            };

      cvFiles.push({
        id:
          file.$id,
        file_name:
          file.name,
        kind,
        company:
          parsed.company,
        role:
          parsed.role,
        created_at:
          file.$createdAt ||
          file.createdAt ||
          null,
        size:
          file.sizeOriginal ||
          file.size ||
          null,
        download_url:
          downloadUrl
      });
    }

    const cvReadyByJob =
      new Map();

    for (const job of jobs) {
      cvReadyByJob.set(
        job.$id,
        hasCustomizedCv(
          resumeFiles,
          job
        )
      );
    }

    const sourceCounts =
      countBy(
        jobs,
        job =>
          normalize(
            job.source_platform ||
            job.source ||
            "UNKNOWN"
          )
      );

    const eligibleJobs =
      jobs.filter(isEligible);

    const highMatchJobs =
      jobs.filter(job =>
        lower(
          job.match_status
        ) === "high_match" ||
        matchScore(job) >= 80
      );

    const priorityJobs =
      jobs.filter(job =>
        lower(
          job.opportunity_status
        ) === "priority"
      );

    const cvReadyJobs =
      jobs.filter(job =>
        cvReadyByJob.get(job.$id)
      );

    const applicationStatuses =
      countBy(
        jobs,
        applicationStatus
      );

    const interventionJobs =
      jobs.filter(job =>
        applicationStatus(job) ===
        "HUMAN_INTERVENTION_REQUIRED"
      );

    const browserRunning =
      jobs.filter(job =>
        applicationStatus(job) ===
        "BROWSER_RUNNING"
      );

    const finalConfirmation =
      jobs.filter(job =>
        applicationStatus(job) ===
        "READY_FOR_FINAL_CONFIRMATION"
      );

    const submittedJobs =
      jobs.filter(job =>
        [
          "SUBMITTED",
          "APPLIED"
        ].includes(
          applicationStatus(job)
        )
      );

    const readyToApply =
      jobs.filter(job =>
        isEligible(job) &&
        applicationStatus(job) ===
          "NOT_APPLIED" &&
        Boolean(jobUrl(job)) &&
        cvReadyByJob.get(job.$id)
      );

    const recentJobs =
      [...jobs]
        .sort(
          (a, b) =>
            createdTime(b) -
            createdTime(a)
        )
        .slice(0, 12)
        .map(job =>
          compactJob(
            job,
            Boolean(
              cvReadyByJob.get(
                job.$id
              )
            )
          )
        );

    const allJobs =
      jobs.map(job =>
        compactJob(
          job,
          Boolean(
            cvReadyByJob.get(
              job.$id
            )
          )
        )
      );

    const applicationQueue =
      jobs
        .filter(job =>
          [
            "APPROVED_FOR_SUBMISSION",
            "BROWSER_RUNNING",
            "HUMAN_INTERVENTION_REQUIRED",
            "READY_FOR_FINAL_CONFIRMATION",
            "SUBMITTED",
            "APPLIED"
          ].includes(
            applicationStatus(job)
          )
        )
        .sort(
          (a, b) =>
            createdTime(b) -
            createdTime(a)
        )
        .slice(0, 20)
        .map(job =>
          compactJob(
            job,
            Boolean(
              cvReadyByJob.get(
                job.$id
              )
            )
          )
        );

    const topReady =
      [...readyToApply]
        .sort(
          (a, b) =>
            (
              opportunityScore(b) +
              matchScore(b)
            ) -
            (
              opportunityScore(a) +
              matchScore(a)
            )
        )
        .slice(0, 8)
        .map(job =>
          compactJob(
            job,
            true
          )
        );

    const opportunities =
      [...proactiveRows]
        .sort(
          (a, b) =>
            numberValue(
              b.proactive_score
            ) -
            numberValue(
              a.proactive_score
            )
        )
        .slice(0, 12)
        .map(compactOpportunity);

    return respond(res, {
      status:
        "SUCCESS",
      generated_at:
        new Date().toISOString(),

      overview: {
        total_jobs:
          jobs.length,
        eligible:
          eligibleJobs.length,
        high_match:
          highMatchJobs.length,
        priority:
          priorityJobs.length,
        cv_ready:
          cvReadyJobs.length,
        ready_to_apply:
          readyToApply.length,
        browser_running:
          browserRunning.length,
        human_intervention:
          interventionJobs.length,
        final_confirmation:
          finalConfirmation.length,
        submitted:
          submittedJobs.length
      },

      source_counts:
        sourceCounts,

      application_statuses:
        applicationStatuses,

      cv_files:
        cvFiles,

      cv: {
        master:
          resumeFiles.filter(
            file =>
              lower(file.name) ===
              "master cv fp.docx"
          ).length,
        customized:
          resumeFiles.filter(
            file =>
              lower(file.name)
                .startsWith(
                  FINAL_CV_PREFIX.toLowerCase()
                )
          ).length,
        pending:
          resumeFiles.filter(
            file =>
              lower(file.name)
                .startsWith(
                  PENDING_CV_PREFIX.toLowerCase()
                )
          ).length
      },

      next_actions: {
        human_intervention:
          interventionJobs.length > 0,
        final_confirmation:
          finalConfirmation.length > 0
      },

      ready_to_apply:
        topReady,

      recent_jobs:
        recentJobs,

      all_jobs:
        allJobs,

      applications:
        applicationQueue,

      opportunities,

      notes: [
        "Browser automation never submits without explicit human confirmation.",
        "CAPTCHA, Cloudflare, login, OTP, and verification blockers require human intervention.",
        "Customized CV is considered ready only when a finalized CUSTOMIZED- DOCX exists."
      ]
    });
  } catch (err) {
    error?.(
      err?.stack ||
      err?.message ||
      String(err)
    );

    return respond(res,
      {
        status: "FAILED",
        error:
          err?.message ||
          String(err)
      },
      500
    );
  }
};
