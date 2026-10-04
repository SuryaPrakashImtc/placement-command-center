import { Client, TablesDB, Query } from "node-appwrite";
import { createRemoteJWKSet, jwtVerify } from "jose";

/* =========================================================
   CONFIGURATION
   ========================================================= */

const APPWRITE_ENDPOINT =
  process.env.APPWRITE_ENDPOINT ||
  "https://sgp.cloud.appwrite.io/v1";

const APPWRITE_PROJECT_ID =
  process.env.APPWRITE_PROJECT_ID ||
  "6aa03ac3003c12018958";

const APPWRITE_API_KEY =
  process.env.JOB_AUTOMATION_API_KEY;

const DATABASE_ID =
  process.env.APPWRITE_DATABASE_ID ||
  "6aa03d1800119759c9bb";

const JOBS_TABLE_ID =
  process.env.JOBS_TABLE_ID ||
  "jobs";

/*
 * REAL Resume Files bucket ID.
 */
const RESUME_BUCKET_ID =
  "6ac038600011e9e4bc37";

/*
 * IMPORTANT:
 * This is the actual current master CV filename.
 */
const MASTER_CV_FILENAME =
  "MASTER CV FP.docx";

/*
 * Temporary content budget for the customized
 * one-page CV.
 *
 * IMPORTANT:
 * This is a content-length proxy only.
 * It does NOT itself prove Word pagination.
 */
const MAX_ONE_PAGE_CHARS = 3000;

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.8-flash";

const GITHUB_OIDC_ISSUER =
  "https://token.actions.githubusercontent.com";

const GITHUB_OIDC_AUDIENCE =
  process.env.GITHUB_OIDC_AUDIENCE ||
  "placement-command-center-renderer";

const GITHUB_REPOSITORY =
  process.env.GITHUB_REPOSITORY ||
  "SuryaPrakashImtc/placement-command-center";

const GITHUB_WORKFLOW_REF =
  process.env.GITHUB_WORKFLOW_REF ||
  "SuryaPrakashImtc/placement-command-center/.github/workflows/docx-renderer.yml@refs/heads/main";

const GITHUB_OIDC_JWKS =
  createRemoteJWKSet(
    new URL(
      "https://token.actions.githubusercontent.com/.well-known/jwks"
    )
  );

/*
 * Gemini can temporarily return 503/429/5xx errors.
 *
 * We retry only transient errors.
 *
 * 3 retries means up to 4 total Gemini attempts:
 *
 * Attempt 1
 * wait ~1.5 sec
 * Attempt 2
 * wait ~3 sec
 * Attempt 3
 * wait ~6 sec
 * Attempt 4
 */
const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_BASE_MS = 1500;
const GEMINI_RETRY_JITTER_MS = 500;

const GEMINI_RETRYABLE_STATUS_CODES =
  new Set([
    408,
    429,
    500,
    502,
    503,
    504
  ]);


/* =========================================================
   CANDIDATE TRUTH BASE
   ========================================================= */

const CANDIDATE_TRUTH = {
  name: "Surya Prakash Pandey",

  summary:
    "I am a PGDM Marketing student at IMT Nagpur with hands-on experience in product launch management, B2B marketing communications, stakeholder management, and event marketing through my internship at Blue Star Limited. I have contributed to launch planning, marketing communications, vendor management, and process improvement while collaborating with senior leadership, product teams, creative agencies, and external partners. I am passionate about building brands through structured execution and customer-centric marketing.",

  education: [
    "PGDM — Marketing (Major) & BAIT (Minor) – Institute of Management Technology, Nagpur",
    "2027 | 8.04",
    "Graduation — B. Com (Hons), Seth Anandram Jaipuria College",
    "2024 | 73.86%",
    "12th — Commerce, Gyan Bharati Vidyapith",
    "2021 | 69.73%",
    "10th — Gyan Bharati Vidyapith",
    "2019 | 62.38%"
  ],

  internship: {
    company: "Blue Star Ltd",
    role: "Marketing Intern",
    period: "April 2026 – July 2026",

    bullets: [
      "Supported end-to-end execution of Blue Star's ₹6.5 Cr multi-city launch of 4 commercial HVAC products through marketing communication, event planning, and stakeholder coordination.",
      "Updated 17 product brochures, saving ₹85,000 in agency costs while ensuring technical accuracy and brand consistency.",
      "Created 100+ marketing creatives, 8+ executive presentations, 2 corporate videos, and 2 leadership video shoots, supporting product launches, CSR initiatives, and corporate communication.",
      "Negotiated with 23+ hotels and coordinated vendors, logistics, and booth operations across product launches and corporate events."
    ]
  },

  projects: [
    {
      name:
        "Development of a Technician-Friendly Installation Guide",
      description:
        "Developed a visual installation guide by transforming a complex HVAC SOP into a technician-centric learning resource through structured information design, simplified technical communication, and user-focused visual presentation."
    },

    {
      name:
        "General Mills — Marketing & Commercial Intelligence Dashboard",
      description:
        "Developed a 2-page Power BI dashboard integrating company, consumer, category, market-share, and market data to analyse portfolio performance and identify commercial opportunities."
    },

    {
      name:
        "AI-Driven B2B Prospecting & Client Acquisition — The Insignia Consultant",
      description:
        "Developed an AI-assisted prospecting model using Gemini and ChatGPT to identify, clean, and prioritise 50+ high-potential B2B leads; created 3 client pitch decks, supported 2 live pitches, and drove outreach through targeted marketing audits."
    },

    {
      name:
        "Consumer Research on Sunscreen Brand Switching",
      description:
        "Executed an end-to-end marketing research study by designing the research methodology, surveying 200+ respondents, and analysing consumer behaviour to identify drivers of sunscreen brand switching."
    },

    {
      name:
        "Customer Purchase Behaviour Analytics Dashboard",
      description:
        "Developed an interactive customer analytics dashboard using Power Query, Power Pivot, and DAX, integrating 3 relational datasets, creating 20+ measures, and visualising customer behaviour, product performance, and campaign effectiveness."
    }
  ],

  certifications: [
    "Inbound Marketing Certification – HubSpot Academy, 2026",
    "Marketing & Retail Analytics – Great Learning, 2026",
    "Smart Marketing with Price Psychology – Udemy, 2025",
    "AI Tools & ChatGPT Workshop – BE10X, 2026",
    "Data Analytics Job Simulation – Deloitte (Forage), 2026"
  ],

  skills: [
    "Marketing Analytics - Excel (Power Query, Power Pivot, DAX), Power BI, Tableau, SQL (Basic)",
    "Marketing Communication – Canva, Microsoft PowerPoint, Presentation Design, Visual Communication",
    "AI & Digital Productivity – ChatGPT, Gemini, Claude, Google AI Studio",
    "Office Productivity – Microsoft Excel, PowerPoint, Word, Outlook",
    "Soft Skills – Stakeholder Management, Leadership, Ownership"
  ],

  achievements: [
    "Runner-up – Concord, Intra-College Competition, IMT Nagpur (2026)",
    "Rajya Puraskar Award – Conferred by the Hon'ble Governor of West Bengal for achieving the Rajya Puraskar level in Bharat Scouts & Guides",
    "Jila Puraskar – West Calcutta District Association, Bharat Scouts & Guides"
  ],

  extracurricular: [
    "Institution Industry Partnership Cell (IIPC), IMT Nagpur",
    "Contributed to 2 flagship conclaves, 20+ guest lectures, and an industrial visit by managing 30+ LinkedIn communications, corporate guest coordination, event scripting, logistics, and mess budgeting.",
    "Cubmaster | Bharat Scouts & Guides",
    "Mentored 220+ Cubs and Bulbuls through weekly leadership and life-skills sessions for 15 months, served as Camp Chief for a 50-participant one-day camp, and contributed to student evaluations and school activities.",
    "Bharat Scouts & Guides",
    "Active member for 10+ years; represented West Bengal as Contingent Leader at the 2nd Indo-Bangladesh Scout Friendship Camp."
  ],

  other: [
    "Languages Known: Hindi, English and Bengali",
    "Hobbies & Interests: Brand Storytelling, Geopolitics & Global Affairs, Film & Music Analysis"
  ]
};


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`MISSING_ENV: ${name}`);
  }
}

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


/* =========================================================
   DOCX TEXT EXTRACTION
   ========================================================= */

function extractVisibleText(documentXml) {
  if (!documentXml) {
    return "";
  }

  return decodeXml(
    documentXml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<w:cr[^>]*\/>/g, "\n")
      .replace(/<w:t[^>]*>/g, "")
      .replace(/<\/w:t>/g, "")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function visibleCharacterCount(documentXml) {
  return extractVisibleText(documentXml).length;
}


/* =========================================================
   PARAGRAPH MAPPING
   ========================================================= */

function getParagraphTexts(documentXml) {
  const results = [];

  const paragraphRegex =
    /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;

  let match;
  let index = 0;

  while (
    (match = paragraphRegex.exec(documentXml)) !== null
  ) {
    const xml = match[0];

    const text = decodeXml(
      xml
        .replace(/<w:t[^>]*>/g, "")
        .replace(/<\/w:t>/g, "")
        .replace(/<[^>]+>/g, " ")
    )
      .replace(/\s+/g, " ")
      .trim();

    results.push({
      id: `P${index + 1}`,
      text,
      xml
    });

    index++;
  }

  return results;
}


/* =========================================================
   SAFE PARAGRAPH TEXT REPLACEMENT
   ========================================================= */

function replaceParagraphText(
  paragraphXml,
  newText
) {
  const safeText =
    escapeXml(newText);

  let replaced = false;

  const output =
    paragraphXml.replace(
      /<w:r([^>]*)>[\s\S]*?<\/w:r>/g,
      (runBlock) => {
        if (replaced) {
          return runBlock;
        }

        const hasText =
          /<w:t(?:\s[^>]*)?>/.test(
            runBlock
          );

        if (!hasText) {
          return runBlock;
        }

        replaced = true;

        const runPropertiesMatch =
          runBlock.match(
            /<w:rPr[\s\S]*?<\/w:rPr>/
          );

        const runProperties =
          runPropertiesMatch
            ? runPropertiesMatch[0]
            : "";

        return (
          `<w:r>${runProperties}` +
          `<w:t xml:space="preserve">${safeText}</w:t>` +
          `</w:r>`
        );
      }
    );

  if (replaced) {
    return output;
  }

  const paragraphPropertiesMatch =
    output.match(
      /^<w:p(?:\s[^>]*)?><w:pPr[\s\S]*?<\/w:pPr>/
    );

  if (paragraphPropertiesMatch) {
    const prefix =
      paragraphPropertiesMatch[0];

    return output.replace(
      prefix,
      `${prefix}<w:r><w:t xml:space="preserve">${safeText}</w:t></w:r>`
    );
  }

  return output.replace(
    /^<w:p(?:\s[^>]*)?>/,
    `$&<w:r><w:t xml:space="preserve">${safeText}</w:t></w:r>`
  );
}


/* =========================================================
   APPWRITE REST HELPERS
   ========================================================= */

function appwriteHeaders(extra = {}) {
  return {
    "X-Appwrite-Project":
      APPWRITE_PROJECT_ID,

    "X-Appwrite-Key":
      APPWRITE_API_KEY,

    ...extra
  };
}

async function appwriteRequest(
  path,
  {
    method = "GET",
    headers = {},
    body
  } = {}
) {
  const response =
    await fetch(
      `${APPWRITE_ENDPOINT}${path}`,
      {
        method,
        headers:
          appwriteHeaders(headers),
        body
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `APPWRITE_${response.status}: ${errorText}`
    );
  }

  return response;
}


/* =========================================================
   APPWRITE STORAGE
   ========================================================= */

async function listStorageFiles() {
  const response =
    await appwriteRequest(
      `/storage/buckets/${encodeURIComponent(
        RESUME_BUCKET_ID
      )}/files?limit=100`
    );

  const data =
    await response.json();

  return data.files || [];
}

async function findMasterCvFile() {
  const files =
    await listStorageFiles();

  const exactMatch =
    files.find(
      (file) =>
        file.name ===
        MASTER_CV_FILENAME
    );

  if (exactMatch) {
    return exactMatch;
  }

  const normalizedTarget =
    normalize(
      MASTER_CV_FILENAME
    ).toLowerCase();

  const fallback =
    files.find(
      (file) =>
        normalize(
          file.name
        ).toLowerCase() ===
        normalizedTarget
    );

  if (fallback) {
    return fallback;
  }

  const availableFiles =
    files
      .map(
        (file) =>
          file.name
      )
      .filter(Boolean);

  throw new Error(
    `MASTER_CV_NOT_FOUND: ${MASTER_CV_FILENAME}. Available files in Resume Files bucket: ${availableFiles.join(", ") || "NONE"}`
  );
}

async function downloadStorageFile(
  fileId
) {
  const response =
    await appwriteRequest(
      `/storage/buckets/${encodeURIComponent(
        RESUME_BUCKET_ID
      )}/files/${encodeURIComponent(
        fileId
      )}/download`
    );

  return Buffer.from(
    await response.arrayBuffer()
  );
}

async function uploadStorageFile(
  filename,
  buffer,
  contentType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
) {
  const form =
    new FormData();

  form.append(
    "fileId",
    "unique()"
  );

  form.append(
    "file",
    new Blob(
      [buffer],
      {
        type: contentType
      }
    ),
    filename
  );

  const response =
    await appwriteRequest(
      `/storage/buckets/${encodeURIComponent(
        RESUME_BUCKET_ID
      )}/files`,
      {
        method: "POST",
        body: form
      }
    );

  return response.json();
}


/* =========================================================
   DOCX ZIP/XML
   ========================================================= */

async function loadZip() {
  const module =
    await import("jszip");

  return module.default;
}

async function readDocxXml(
  buffer
) {
  const JSZip =
    await loadZip();

  const zip =
    await JSZip.loadAsync(
      buffer
    );

  const documentEntry =
    zip.file(
      "word/document.xml"
    );

  if (!documentEntry) {
    throw new Error(
      "DOCX_DOCUMENT_XML_NOT_FOUND"
    );
  }

  const documentXml =
    await documentEntry.async(
      "string"
    );

  return {
    zip,
    documentXml
  };
}

/*
 * IMPORTANT:
 * This function now returns the JSZip object.
 *
 * The previous implementation generated a Buffer here
 * and the main flow then tried to call generateAsync()
 * on that Buffer. That would have caused a failure after
 * Gemini succeeded.
 */
async function prepareDocxZip(
  zip,
  documentXml
) {
  /*
   * Remove stale rendered page-break
   * information from document XML.
   */
  documentXml =
    documentXml.replace(
      /<w:lastRenderedPageBreak\s*\/>/g,
      ""
    );

  zip.file(
    "word/document.xml",
    documentXml
  );

  /*
   * Remove cached compatibility pagination
   * information if present.
   */
  const settingsEntry =
    zip.file(
      "word/settings.xml"
    );

  if (settingsEntry) {
    let settingsXml =
      await settingsEntry.async(
        "string"
      );

    settingsXml =
      settingsXml.replace(
        /<w:compatSetting[^>]*name="compatibilityMode"[^>]*\/>/g,
        ""
      );

    zip.file(
      "word/settings.xml",
      settingsXml
    );
  }

  return zip;
}


/* =========================================================
   GEMINI
   ========================================================= */

async function callGemini(
  prompt
) {
  requireEnv(
    "GEMINI_API_KEY",
    GEMINI_API_KEY
  );

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent`;

  let lastStatus = null;
  let lastErrorText = "";

  for (
    let attempt = 0;
    attempt <= GEMINI_MAX_RETRIES;
    attempt++
  ) {
    try {
      const response =
        await fetch(
          url,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              /*
               * Keep the API key out of the URL.
               */
              "x-goog-api-key":
                GEMINI_API_KEY
            },

            body: JSON.stringify({
              contents: [
                {
                  role: "user",

                  parts: [
                    {
                      text: prompt
                    }
                  ]
                }
              ],

              generationConfig: {
                temperature: 0.1,
                responseMimeType:
                  "application/json"
              }
            })
          }
        );

      if (response.ok) {
        const data =
          await response.json();

        const text =
          data?.candidates?.[0]
            ?.content?.parts?.[0]
            ?.text;

        if (!text) {
          throw new Error(
            "GEMINI_EMPTY_RESPONSE"
          );
        }

        try {
          return JSON.parse(
            text
          );
        } catch {
          const cleaned =
            text
              .replace(
                /^```json\s*/i,
                ""
              )
              .replace(
                /\s*```$/i,
                ""
              )
              .trim();

          return JSON.parse(
            cleaned
          );
        }
      }

      lastStatus =
        response.status;

      lastErrorText =
        await response.text();

      const shouldRetry =
        GEMINI_RETRYABLE_STATUS_CODES.has(
          response.status
        );

      const finalAttempt =
        attempt >=
        GEMINI_MAX_RETRIES;

      if (
        !shouldRetry ||
        finalAttempt
      ) {
        throw new Error(
          `GEMINI_${response.status}_AFTER_${attempt + 1}_ATTEMPTS: ${lastErrorText}`
        );
      }

      /*
       * Exponential backoff:
       *
       * retry 1 ≈ 1.5 sec
       * retry 2 ≈ 3 sec
       * retry 3 ≈ 6 sec
       *
       * Plus small random jitter.
       */
      const backoff =
        GEMINI_RETRY_BASE_MS *
        Math.pow(
          2,
          attempt
        );

      const jitter =
        Math.floor(
          Math.random() *
          GEMINI_RETRY_JITTER_MS
        );

      const waitMs =
        backoff + jitter;

      console.warn(
        `GEMINI_RETRY: status=${response.status}, attempt=${attempt + 1}/${GEMINI_MAX_RETRIES + 1}, waiting=${waitMs}ms`
      );

      await sleep(
        waitMs
      );

    } catch (error) {
      /*
       * Do not retry our own final Gemini errors.
       */
      if (
        String(
          error?.message || ""
        ).startsWith(
          "GEMINI_"
        )
      ) {
        throw error;
      }

      /*
       * Network/fetch failure.
       * Retry while attempts remain.
       */
      if (
        attempt >=
        GEMINI_MAX_RETRIES
      ) {
        throw new Error(
          `GEMINI_NETWORK_ERROR_AFTER_${attempt + 1}_ATTEMPTS: ${error?.message ?? String(error)}`
        );
      }

      const backoff =
        GEMINI_RETRY_BASE_MS *
        Math.pow(
          2,
          attempt
        );

      const jitter =
        Math.floor(
          Math.random() *
          GEMINI_RETRY_JITTER_MS
        );

      const waitMs =
        backoff + jitter;

      console.warn(
        `GEMINI_NETWORK_RETRY: attempt=${attempt + 1}/${GEMINI_MAX_RETRIES + 1}, waiting=${waitMs}ms, error=${error?.message ?? String(error)}`
      );

      await sleep(
        waitMs
      );
    }
  }

  throw new Error(
    `GEMINI_${lastStatus || "UNKNOWN"}_FAILED: ${lastErrorText}`
  );
}


/* =========================================================
   GEMINI EDIT PLAN
   ========================================================= */

async function generateEditPlan({
  job,
  masterText,
  paragraphs,
  maxChars
}) {
  const paragraphData =
    paragraphs.map(
      (paragraph) => ({
        id:
          paragraph.id,

        text:
          paragraph.text
      })
    );

  const prompt = `
You are a professional ATS resume content editor.

Your task is to create a STRICT content-edit plan for an existing
master CV.

The master CV's FORMAT and DESIGN are completely locked.

NON-NEGOTIABLE RULES:

1. Never redesign the CV.
2. Never create a new CV from scratch.
3. Never change fonts.
4. Never change font sizes.
5. Never change font families.
6. Never change colors.
7. Never change margins.
8. Never change spacing.
9. Never change line spacing.
10. Never change paragraph spacing.
11. Never change section order.
12. Never change layout.
13. Never add new sections.
14. Never invent experience.
15. Never invent numbers.
16. Never invent employers.
17. Never invent responsibilities.
18. Never invent skills.
19. Never invent qualifications.
20. Never invent achievements.
21. Never alter factual Blue Star internship information.
22. Never alter factual education information.
23. Only modify existing CONTENT.
24. Rewrites must be truthful and based on the supplied CV.
25. Rewritten text should be equal to or SHORTER than the original.
26. Prefer shortening or removing low-value content rather than
    expanding content.
27. Prioritize content relevant to the target job.
28. Final visible text must not exceed ${maxChars} characters.
29. Do not remove internship paragraphs.
30. Do not remove education paragraphs.
31. Do not invent paragraph IDs.
32. Only use paragraph IDs from the supplied paragraph list.

TARGET JOB:

${JSON.stringify(
  job,
  null,
  2
)}

MASTER CV TEXT:

${masterText}

MASTER CV PARAGRAPHS:

${JSON.stringify(
  paragraphData,
  null,
  2
)}

Return ONLY valid JSON in exactly this structure:

{
  "summary": {
    "paragraphId": "P<number>",
    "replacement": "..."
  },

  "projects": [
    {
      "paragraphId": "P<number>",
      "replacement": "..."
    }
  ],

  "certificationsToRemove": [
    "P<number>"
  ],

  "achievementsToRemove": [
    "P<number>"
  ],

  "skillsToRemove": [
    "P<number>"
  ],

  "extracurricularToRemove": [
    "P<number>"
  ],

  "otherToRemove": [
    "P<number>"
  ],

  "additionalRemovals": [
    "P<number>"
  ]
}

If no change is necessary:
- use null for summary
- use [] for arrays

IMPORTANT:

Do not rewrite every project automatically.

Only rewrite a project if the existing project can be made
materially more relevant to the target role WITHOUT making it longer.

Do not remove important evidence merely to make the CV shorter.

Never remove Blue Star internship paragraphs.

Never remove education paragraphs.
`;

  return callGemini(
    prompt
  );
}


/* =========================================================
   PARAGRAPH CLASSIFICATION
   ========================================================= */

function classifyParagraph(
  text
) {
  const value =
    normalize(
      text
    ).toLowerCase();

  if (!value) {
    return "empty";
  }

  /*
   * Protected internship content.
   */
  if (
    value.includes("blue star") ||
    value.includes("marketing intern") ||
    value.includes("₹6.5") ||
    value.includes("6.5 cr") ||
    value.includes("17 product brochures") ||
    value.includes("100+ marketing") ||
    value.includes("23+ hotels")
  ) {
    return "protected-internship";
  }

  /*
   * Protected education content.
   */
  if (
    value.includes("pgdm") ||
    value.includes("imt nagpur") ||
    value.includes("b. com") ||
    value.includes("graduation") ||
    value.includes("12th") ||
    value.includes("10th") ||
    value.includes("cgpa") ||
    value.includes("73.86") ||
    value.includes("69.73") ||
    value.includes("62.38")
  ) {
    return "protected-education";
  }

  /*
   * Certifications.
   */
  if (
    value.includes("hubspot") ||
    value.includes("great learning") ||
    value.includes("udemy") ||
    value.includes("be10x") ||
    value.includes("deloitte") ||
    value.includes("forage")
  ) {
    return "certification";
  }

  /*
   * Achievements.
   */
  if (
    value.includes("runner-up") ||
    value.includes("rajya puraskar") ||
    value.includes("jila puraskar")
  ) {
    return "achievement";
  }

  /*
   * Extra-curricular.
   */
  if (
    value.includes("institution industry") ||
    value.includes("iipc") ||
    value.includes("cubmaster") ||
    value.includes("bharat scouts") ||
    value.includes("contingent leader")
  ) {
    return "extracurricular";
  }

  /*
   * Other information.
   */
  if (
    value.includes("languages known") ||
    value.includes("hobbies") ||
    value.includes("interests") ||
    value.includes("brand storytelling") ||
    value.includes("geopolitics")
  ) {
    return "other";
  }

  /*
   * Everything else.
   */
  return "other";
}


/* =========================================================
   PROTECTION / VALIDATION
   ========================================================= */

function paragraphMap(
  paragraphs
) {
  return new Map(
    paragraphs.map(
      (paragraph) => [
        paragraph.id,
        paragraph
      ]
    )
  );
}

function isProtectedParagraph(
  paragraph
) {
  const type =
    classifyParagraph(
      paragraph.text
    );

  return (
    type ===
      "protected-internship" ||
    type ===
      "protected-education"
  );
}

function validateReplacement(
  paragraph,
  replacement
) {
  if (!paragraph) {
    return false;
  }

  if (
    isProtectedParagraph(
      paragraph
    )
  ) {
    return false;
  }

  const oldLength =
    normalize(
      paragraph.text
    ).length;

  const newLength =
    normalize(
      replacement
    ).length;

  /*
   * AI-generated text can NEVER increase
   * the original paragraph length.
   */
  if (
    newLength >
    oldLength
  ) {
    return false;
  }

  if (
    newLength === 0
  ) {
    return false;
  }

  return true;
}


/* =========================================================
   APPLY AI EDIT PLAN
   ========================================================= */

function applyEditPlan(
  documentXml,
  paragraphs,
  plan
) {
  const map =
    paragraphMap(
      paragraphs
    );

  let output =
    documentXml;

  /*
   * SUMMARY
   */

  if (
    plan?.summary?.paragraphId &&
    typeof plan.summary.replacement ===
      "string"
  ) {
    const paragraph =
      map.get(
        plan.summary.paragraphId
      );

    if (
      paragraph &&
      validateReplacement(
        paragraph,
        plan.summary.replacement
      )
    ) {
      output =
        output.replace(
          paragraph.xml,
          replaceParagraphText(
            paragraph.xml,
            plan.summary.replacement
          )
        );
    }
  }

  /*
   * PROJECTS
   */

  if (
    Array.isArray(
      plan?.projects
    )
  ) {
    for (
      const project of
        plan.projects
    ) {
      if (
        !project?.paragraphId ||
        typeof project.replacement !==
          "string"
      ) {
        continue;
      }

      const paragraph =
        map.get(
          project.paragraphId
        );

      if (
        !paragraph ||
        !validateReplacement(
          paragraph,
          project.replacement
        )
      ) {
        continue;
      }

      output =
        output.replace(
          paragraph.xml,
          replaceParagraphText(
            paragraph.xml,
            project.replacement
          )
        );
    }
  }

  /*
   * REMOVALS
   */

  const removalIds = [
    ...(Array.isArray(
      plan?.certificationsToRemove
    )
      ? plan.certificationsToRemove
      : []),

    ...(Array.isArray(
      plan?.achievementsToRemove
    )
      ? plan.achievementsToRemove
      : []),

    ...(Array.isArray(
      plan?.skillsToRemove
    )
      ? plan.skillsToRemove
      : []),

    ...(Array.isArray(
      plan?.extracurricularToRemove
    )
      ? plan.extracurricularToRemove
      : []),

    ...(Array.isArray(
      plan?.otherToRemove
    )
      ? plan.otherToRemove
      : []),

    ...(Array.isArray(
      plan?.additionalRemovals
    )
      ? plan.additionalRemovals
      : [])
  ];

  /*
   * Deduplicate IDs.
   */
  const uniqueRemovalIds =
    [
      ...new Set(
        removalIds
      )
    ];

  for (
    const paragraphId of
      uniqueRemovalIds
  ) {
    const paragraph =
      map.get(
        paragraphId
      );

    if (!paragraph) {
      continue;
    }

    /*
     * NEVER remove internship or education.
     */
    if (
      isProtectedParagraph(
        paragraph
      )
    ) {
      continue;
    }

    const text =
      normalize(
        paragraph.text
      );

    /*
     * Do not remove empty structural paragraphs.
     */
    if (
      text.length === 0
    ) {
      continue;
    }

    /*
     * Do not remove unusually long paragraphs
     * through the AI removal mechanism.
     */
    if (
      text.length > 300
    ) {
      continue;
    }

    output =
      output.replace(
        paragraph.xml,
        ""
      );
  }

  return output;
}


/* =========================================================
   DETERMINISTIC CONTENT TRIM
   ========================================================= */

/*
 * If the AI plan still leaves the CV above the
 * 3,000-character content budget, trim low-priority
 * content from the ACTUAL paragraph structure.
 *
 * This never changes formatting.
 */
function deterministicTrim(
  documentXml,
  maxChars
) {
  let currentXml =
    documentXml;

  let currentChars =
    visibleCharacterCount(
      currentXml
    );

  if (
    currentChars <=
    maxChars
  ) {
    return currentXml;
  }

  /*
   * Lower-priority categories first.
   */
  const priorities = [
    "other",
    "extracurricular",
    "achievement",
    "certification"
  ];

  for (
    const priority of
      priorities
  ) {
    const paragraphs =
      getParagraphTexts(
        currentXml
      );

    for (
      const paragraph of
        paragraphs
    ) {
      if (
        classifyParagraph(
          paragraph.text
        ) !== priority
      ) {
        continue;
      }

      if (
        isProtectedParagraph(
          paragraph
        )
      ) {
        continue;
      }

      currentXml =
        currentXml.replace(
          paragraph.xml,
          ""
        );

      currentChars =
        visibleCharacterCount(
          currentXml
        );

      if (
        currentChars <=
        maxChars
      ) {
        return currentXml;
      }
    }
  }

  /*
   * If still too long, remove project content
   * only after lower-priority sections have been
   * exhausted.
   */
  const paragraphs =
    getParagraphTexts(
      currentXml
    );

  for (
    const paragraph of
      paragraphs
  ) {
    if (
      isProtectedParagraph(
        paragraph
      )
    ) {
      continue;
    }

    const text =
      normalize(
        paragraph.text
      );

    if (
      text.length < 20
    ) {
      continue;
    }

    const lower =
      text.toLowerCase();

    /*
     * Never delete section headings.
     */
    const isHeading =
      [
        "professional summary",
        "education",
        "internships",
        "projects",
        "certifications",
        "skills",
        "achievements",
        "extra-curricular activity",
        "extra-curricular activities",
        "other information"
      ].includes(
        lower
      );

    if (isHeading) {
      continue;
    }

    /*
     * At this final stage only remove
     * non-protected content.
     */
    currentXml =
      currentXml.replace(
        paragraph.xml,
        ""
      );

    currentChars =
      visibleCharacterCount(
        currentXml
      );

    if (
      currentChars <=
      maxChars
    ) {
      return currentXml;
    }
  }

  return currentXml;
}


/* =========================================================
   APPWRITE TABLESDB
   ========================================================= */

function createTablesClient() {
  requireEnv(
    "APPWRITE_API_KEY",
    APPWRITE_API_KEY
  );

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

  return new TablesDB(
    client
  );
}

async function getJobs() {
  const tables =
    createTablesClient();

  const result =
    await tables.listRows(
      DATABASE_ID,
      JOBS_TABLE_ID,
      [
        Query.limit(100)
      ]
    );

  return (
    result.rows || []
  );
}


/* =========================================================
   JOB SELECTION
   ========================================================= */

function isTruthy(value) {
  if (
    value === true ||
    value === 1
  ) {
    return true;
  }

  const normalized =
    normalize(
      value
    ).toLowerCase();

  return [
    "true",
    "yes",
    "eligible",
    "high",
    "medium"
  ].includes(
    normalized
  );
}

function getMatchScore(
  job
) {
  const candidates = [
    job.match_score,
    job.matchScore,
    job.opportunity_score,
    job.opportunityScore,
    job.score
  ];

  for (
    const value of
      candidates
  ) {
    const number =
      Number(value);

    if (
      Number.isFinite(
        number
      )
    ) {
      return number;
    }
  }

  return 0;
}

function selectBestJob(
  jobs
) {
  const eligible =
    jobs.filter(
      (job) => {
        const eligibility =
          job.eligibility_status ??
          job.eligibilityStatus ??
          job.eligible;

        /*
         * If eligibility isn't available,
         * don't unnecessarily exclude the job.
         */
        if (
          eligibility ===
            undefined ||
          eligibility === null
        ) {
          return true;
        }

        return isTruthy(
          eligibility
        );
      }
    );

  if (
    !eligible.length
  ) {
    return null;
  }

  return eligible.sort(
    (a, b) =>
      getMatchScore(b) -
      getMatchScore(a)
  )[0];
}


/* =========================================================
   JOB DATA
   ========================================================= */

function getJobDescription(
  job
) {
  return (
    job.job_description ??
    job.jobDescription ??
    job.description ??
    job.jd_text ??
    job.jdText ??
    ""
  );
}

function compactJobForGemini(
  job
) {
  return {
    title:
      job.title ??
      job.job_title ??
      "",

    company:
      job.company ??
      job.company_name ??
      "",

    location:
      job.location ??
      "",

    url:
      job.url ??
      job.job_url ??
      "",

    description:
      getJobDescription(
        job
      ),

    eligibility:
      job.eligibility_status ??
      job.eligibilityStatus ??
      job.eligible ??
      "",

    match_score:
      getMatchScore(
        job
      ),

    match_reason:
      job.match_reason ??
      job.matchReason ??
      ""
  };
}


/* =========================================================
   GITHUB ACTIONS OIDC / RENDER SOURCE
   ========================================================= */

function getAuthorizationHeader(req) {
  return (
    req?.headers?.authorization ||
    req?.headers?.Authorization ||
    ""
  );
}

async function verifyGitHubActionsIdentity(req) {
  const authorization =
    getAuthorizationHeader(req);

  if (!authorization.startsWith("Bearer ")) {
    throw new Error(
      "RENDER_SOURCE_UNAUTHORIZED: missing GitHub OIDC bearer token"
    );
  }

  const token =
    authorization.slice("Bearer ".length).trim();

  if (!token) {
    throw new Error(
      "RENDER_SOURCE_UNAUTHORIZED: empty GitHub OIDC token"
    );
  }

  const { payload } =
    await jwtVerify(
      token,
      GITHUB_OIDC_JWKS,
      {
        issuer:
          GITHUB_OIDC_ISSUER,
        audience:
          GITHUB_OIDC_AUDIENCE
      }
    );

  if (payload.repository !== GITHUB_REPOSITORY) {
    throw new Error(
      "RENDER_SOURCE_FORBIDDEN: GitHub repository does not match"
    );
  }

  if (payload.workflow_ref !== GITHUB_WORKFLOW_REF) {
    throw new Error(
      "RENDER_SOURCE_FORBIDDEN: GitHub workflow does not match"
    );
  }

  if (
    payload.ref &&
    payload.ref !== "refs/heads/main"
  ) {
    throw new Error(
      "RENDER_SOURCE_FORBIDDEN: GitHub ref is not main"
    );
  }

  return payload;
}

async function findLatestCustomizedCvFile() {
  const files =
    await listStorageFiles();

  const candidates =
    files.filter(
      (file) => {
        const name =
          normalize(file.name);

        return (
          name.startsWith("CUSTOMIZED-") &&
          name.toLowerCase().endsWith(".docx")
        );
      }
    );

  candidates.sort(
    (a, b) => {
      const aTime =
        new Date(
          a.$createdAt ||
          a.createdAt ||
          0
        ).getTime();

      const bTime =
        new Date(
          b.$createdAt ||
          b.createdAt ||
          0
        ).getTime();

      return bTime - aTime;
    }
  );

  if (!candidates.length) {
    throw new Error(
      "RENDER_SOURCE_NOT_FOUND: no customized CV DOCX exists in the Resume Files bucket"
    );
  }

  return candidates[0];
}

async function getRenderSource(req) {
  await verifyGitHubActionsIdentity(req);

  const file =
    await findLatestCustomizedCvFile();

  const buffer =
    await downloadStorageFile(file.$id);

  return {
    status: "SUCCESS",
    file: {
      id: file.$id,
      name: file.name,
      created_at:
        file.$createdAt ||
        file.createdAt ||
        null,
      bytes: buffer.length
    },
    encoding: "base64",
    content:
      buffer.toString("base64")
  };
}


/* =========================================================
   MAIN CUSTOMIZATION FLOW
   ========================================================= */

async function customizeResume() {
  requireEnv(
    "APPWRITE_API_KEY",
    APPWRITE_API_KEY
  );

  requireEnv(
    "GEMINI_API_KEY",
    GEMINI_API_KEY
  );

  /*
   * -------------------------------------------------------
   * 1. Get jobs
   * -------------------------------------------------------
   */

  const jobs =
    await getJobs();

  /*
   * -------------------------------------------------------
   * 2. Select best eligible job
   * -------------------------------------------------------
   */

  const job =
    selectBestJob(
      jobs
    );

  if (!job) {
    return {
      status:
        "FAILED",

      error:
        "NO_ELIGIBLE_JOB_FOUND"
    };
  }

  /*
   * -------------------------------------------------------
   * 3. Find the actual master CV
   * -------------------------------------------------------
   */

  const masterFile =
    await findMasterCvFile();

  /*
   * -------------------------------------------------------
   * 4. Download master CV
   * -------------------------------------------------------
   */

  const masterBuffer =
    await downloadStorageFile(
      masterFile.$id
    );

  /*
   * -------------------------------------------------------
   * 5. Read DOCX XML
   * -------------------------------------------------------
   */

  const {
    zip,
    documentXml
  } =
    await readDocxXml(
      masterBuffer
    );

  /*
   * -------------------------------------------------------
   * 6. Extract master text
   * -------------------------------------------------------
   */

  const masterVisibleText =
    extractVisibleText(
      documentXml
    );

  const masterVisibleChars =
    masterVisibleText.length;

  /*
   * Safety check.
   *
   * The current master is intentionally allowed to be
   * larger than the one-page customized budget because
   * the uploaded master is a 2-page document.
   */
  if (
    masterVisibleChars >
    6000
  ) {
    throw new Error(
      `MASTER_CV_CONTENT_TOO_LARGE: ${masterVisibleChars} visible characters exceeds safety ceiling 6000`
    );
  }

  /*
   * -------------------------------------------------------
   * 7. Build paragraph map
   * -------------------------------------------------------
   */

  const paragraphs =
    getParagraphTexts(
      documentXml
    );

  /*
   * -------------------------------------------------------
   * 8. Generate AI edit plan
   * -------------------------------------------------------
   */

  const plan =
    await generateEditPlan({
      job:
        compactJobForGemini(
          job
        ),

      masterText:
        masterVisibleText,

      paragraphs,

      maxChars:
        MAX_ONE_PAGE_CHARS
    });

  /*
   * -------------------------------------------------------
   * 9. Apply safe AI edits
   * -------------------------------------------------------
   */

  let customizedXml =
    applyEditPlan(
      documentXml,
      paragraphs,
      plan
    );

  /*
   * -------------------------------------------------------
   * 10. Check content length
   * -------------------------------------------------------
   */

  let customizedChars =
    visibleCharacterCount(
      customizedXml
    );

  /*
   * -------------------------------------------------------
   * 11. Deterministic trimming if required
   * -------------------------------------------------------
   */

  if (
    customizedChars >
    MAX_ONE_PAGE_CHARS
  ) {
    customizedXml =
      deterministicTrim(
        customizedXml,
        MAX_ONE_PAGE_CHARS
      );

    customizedChars =
      visibleCharacterCount(
        customizedXml
      );
  }

  /*
   * -------------------------------------------------------
   * 12. Final content gate
   * -------------------------------------------------------
   */

  if (
    customizedChars >
    MAX_ONE_PAGE_CHARS
  ) {
    throw new Error(
      `ONE_PAGE_GATE_FAILED: customized content remained at ${customizedChars} characters; maximum allowed is ${MAX_ONE_PAGE_CHARS}. No CV was uploaded.`
    );
  }

  /*
   * -------------------------------------------------------
   * 13. Write customized DOCX
   * -------------------------------------------------------
   */

  const outputZip =
    await prepareDocxZip(
      zip,
      customizedXml
    );

  /*
   * -------------------------------------------------------
   * 14. Generate final DOCX
   * -------------------------------------------------------
   *
   * IMPORTANT:
   * We intentionally do NOT modify docProps/app.xml to
   * falsely claim that the document has one page.
   */

  const finalBuffer =
    await outputZip.generateAsync({
      type:
        "nodebuffer",

      compression:
        "DEFLATE"
    });

  /*
   * -------------------------------------------------------
   * 15. Generate output filename
   * -------------------------------------------------------
   */

  const timestamp =
    new Date()
      .toISOString()
      .replace(
        /[:.]/g,
        "-"
      );

  const jobTitle =
    normalize(
      job.title ??
      job.job_title ??
      "Job"
    )
      .replace(
        /[^a-zA-Z0-9-_ ]/g,
        ""
      )
      .replace(
        /\s+/g,
        "-"
      )
      .slice(
        0,
        80
      );

  const company =
    normalize(
      job.company ??
      job.company_name ??
      "Company"
    )
      .replace(
        /[^a-zA-Z0-9-_ ]/g,
        ""
      )
      .replace(
        /\s+/g,
        "-"
      )
      .slice(
        0,
        80
      );

  const outputFilename =
    `CUSTOMIZED-${company}-${jobTitle}-${timestamp}.docx`;

  /*
   * -------------------------------------------------------
   * 16. Upload customized copy
   * -------------------------------------------------------
   *
   * NEVER overwrite master CV.
   */

  const uploaded =
    await uploadStorageFile(
      outputFilename,
      finalBuffer
    );

  /*
   * -------------------------------------------------------
   * 17. Return result
   * -------------------------------------------------------
   */

  return {
    status:
      "SUCCESS",

    message:
      "Customized resume created successfully without modifying the master CV.",

    job: {
      id:
        job.$id ??
        job.id ??
        null,

      title:
        job.title ??
        job.job_title ??
        null,

      company:
        job.company ??
        job.company_name ??
        null,

      match_score:
        getMatchScore(
          job
        )
    },

    master_cv: {
      file_id:
        masterFile.$id,

      filename:
        masterFile.name,

      visible_characters:
        masterVisibleChars
    },

    customized_cv: {
      file_id:
        uploaded.$id,

      filename:
        uploaded.name,

      visible_characters:
        customizedChars
    },

    content_budget: {
      maximum_visible_characters:
        MAX_ONE_PAGE_CHARS,

      actual_visible_characters:
        customizedChars,

      remaining_capacity:
        Math.max(
          0,
          MAX_ONE_PAGE_CHARS -
            customizedChars
        )
    },

    note:
      "The 3,000-character gate is a conservative content proxy for the one-page requirement. It does not by itself prove rendered pagination is exactly one page."
  };
}


/* =========================================================
   APPWRITE FUNCTION ENTRYPOINT
   ========================================================= */

export default async function main({
  req,
  res
}) {
  try {
    if (req?.path === "/render-source") {
      if (
        String(req?.method || "GET").toUpperCase() !==
        "GET"
      ) {
        return res.json(
          {
            status: "FAILED",
            error: "METHOD_NOT_ALLOWED"
          },
          405
        );
      }

      const result =
        await getRenderSource(req);

      return res.json(result);
    }

    const result =
      await customizeResume();

    return res.json(result);

  } catch (error) {
    console.error(
      "RESUME_CUSTOMIZATION_ERROR",
      error
    );

    const message =
      error?.message ??
      String(error);

    const status =
      message.startsWith(
        "RENDER_SOURCE_UNAUTHORIZED"
      )
        ? 401
        : message.startsWith(
            "RENDER_SOURCE_FORBIDDEN"
          )
          ? 403
          : 500;

    return res.json(
      {
        status: "FAILED",
        error: message
      },
      status
    );
  }
}
