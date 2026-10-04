import { Client, TablesDB, Query } from "node-appwrite";

/* =========================================================
   CONFIGURATION
   ========================================================= */

const APPWRITE_ENDPOINT =
  process.env.APPWRITE_ENDPOINT || "https://sgp.cloud.appwrite.io/v1";

const APPWRITE_PROJECT_ID =
  process.env.APPWRITE_PROJECT_ID || "6aa03ac3003c12018958";

const APPWRITE_API_KEY =
  process.env.JOB_AUTOMATION_API_KEY;

const DATABASE_ID =
  process.env.APPWRITE_DATABASE_ID || "6aa03d1800119759c9bb";

const JOBS_TABLE_ID =
  process.env.JOBS_TABLE_ID || "jobs";

/*
 * IMPORTANT:
 * This is the real Resume Files bucket ID.
 * Do not replace this with a guessed bucket ID.
 */
const RESUME_BUCKET_ID = "6ac038600011e9e4bc37";

const MASTER_CV_FILENAME = "MASTER CV FP(5).docx";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

/*
 * This is no longer used as the primary one-page gate.
 *
 * The function now dynamically calculates the visible character
 * count of the master CV and uses that as the content ceiling.
 *
 * This value remains only as an emergency absolute upper bound.
 */
const ABSOLUTE_MAX_CHARS = 3600;

/* =========================================================
   CANDIDATE TRUTH BASE
   ========================================================= */

const CANDIDATE_TRUTH = {
  name: "Surya Prakash Pandey",

  summary:
    "PGDM Marketing student at IMT Nagpur with hands-on experience in product launch management, B2B marketing communications, stakeholder management, and event marketing at Blue Star Ltd. Experienced in launch planning, marketing communications, vendor management, and process improvement through work with senior leadership, product teams, creative agencies, and external partners. Interested in brand and customer-centric marketing.",

  education: [
    "PGDM – Marketing Major & BAIT Minor, IMT Nagpur, 2027, CGPA 8.04",
    "B.Com (Hons), Seth Anandram Jaipuria College, 2024, 73.86%",
    "Class XII, 2021, 69.73%",
    "Class X, 2019, 62.38%"
  ],

  internship: {
    company: "Blue Star Ltd",
    role: "Marketing Intern",
    period: "Apr–Jul 2026",

    bullets: [
      "Supported ₹6.5 Cr multi-city launch of 4 commercial HVAC products.",
      "Updated 17 product brochures, saving ₹85K in agency costs.",
      "Created 100+ marketing creatives, 8+ executive presentations, 2 corporate videos, and supported 2 leadership video shoots.",
      "Negotiated with 23+ hotels and coordinated vendors, logistics, and booth operations."
    ]
  },

  projects: [
    {
      name: "Technician-Friendly Installation Guide",
      description:
        "Created a simplified installation guide to improve technician usability and communication."
    },
    {
      name: "General Mills Marketing & Commercial Intelligence Dashboard",
      description:
        "Built a 2-page Power BI dashboard integrating company, consumer, category, market-share, and market data."
    },
    {
      name: "AI-Driven B2B Prospecting & Client Acquisition – The Insignia Consultant",
      description:
        "Used Gemini and ChatGPT to identify 50+ leads, create 3 pitch decks, conduct 2 live pitches, and support targeted marketing audits."
    },
    {
      name: "Sunscreen Switching Research",
      description:
        "Conducted marketing research with 200+ respondents to understand consumer switching behaviour."
    },
    {
      name: "Customer Purchase Behaviour Dashboard",
      description:
        "Used Power Query, Power Pivot, and DAX across 3 relational datasets with 20+ measures."
    }
  ],

  certifications: [
    "HubSpot Inbound Marketing",
    "Great Learning Marketing & Retail Analytics",
    "Udemy Smart Marketing with Price Psychology",
    "BE10X AI Tools & ChatGPT",
    "Deloitte Forage Data Analytics"
  ],

  skills: [
    "Excel: Power Query, Power Pivot, DAX",
    "Power BI",
    "Tableau",
    "SQL Basic",
    "Canva",
    "PowerPoint",
    "Presentation Design",
    "Visual Communication",
    "ChatGPT",
    "Gemini",
    "Claude",
    "Google AI Studio",
    "Office Productivity",
    "Stakeholder Management",
    "Leadership",
    "Ownership"
  ],

  achievements: [
    "Runner-up – Concord 2026, IMT Nagpur",
    "Rajya Puraskar",
    "Jila Puraskar"
  ],

  extracurricular: [
    "Institution Industry Partnership Cell, IMT Nagpur",
    "Cubmaster",
    "Bharat Scouts & Guides – 10+ years",
    "Contingent Leader – 2nd Indo-Bangladesh Scout Friendship Camp"
  ],

  other: [
    "Languages: Hindi, English, Bengali",
    "Interests: Brand Storytelling, Geopolitics & Global Affairs, Film & Music Analysis"
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

/*
 * Removes XML markup while retaining visible document text.
 */
function extractVisibleText(documentXml) {
  if (!documentXml) return "";

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

function getParagraphTexts(documentXml) {
  const results = [];

  const paragraphRegex =
    /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;

  let match;
  let index = 0;

  while ((match = paragraphRegex.exec(documentXml)) !== null) {
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

/*
 * Replaces only the visible text inside a paragraph.
 *
 * IMPORTANT:
 * Existing paragraph formatting, runs, fonts, colors,
 * paragraph properties, spacing, margins, etc. remain untouched.
 */
function replaceParagraphText(paragraphXml, newText) {
  const safeText = escapeXml(newText);

  let replaced = false;

  const output = paragraphXml.replace(
    /<w:r([^>]*)>[\s\S]*?<\/w:r>/g,
    (runBlock) => {
      if (replaced) return runBlock;

      const hasText = /<w:t(?:\s[^>]*)?>/.test(runBlock);

      if (!hasText) {
        return runBlock;
      }

      replaced = true;

      const runPropertiesMatch =
        runBlock.match(/<w:rPr[\s\S]*?<\/w:rPr>/);

      const runProperties = runPropertiesMatch
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

  /*
   * If there was no existing text run, create one while
   * preserving the paragraph properties.
   */
  const paragraphPropertiesMatch =
    output.match(/^<w:p(?:\s[^>]*)?><w:pPr[\s\S]*?<\/w:pPr>/);

  if (paragraphPropertiesMatch) {
    const prefix = paragraphPropertiesMatch[0];

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
    "X-Appwrite-Project": APPWRITE_PROJECT_ID,
    "X-Appwrite-Key": APPWRITE_API_KEY,
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
  const response = await fetch(
    `${APPWRITE_ENDPOINT}${path}`,
    {
      method,
      headers: appwriteHeaders(headers),
      body
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `APPWRITE_${response.status}: ${errorText}`
    );
  }

  return response;
}

/* =========================================================
   STORAGE
   ========================================================= */

async function listStorageFiles() {
  const response = await appwriteRequest(
    `/storage/buckets/${encodeURIComponent(
      RESUME_BUCKET_ID
    )}/files?limit=100`
  );

  const data = await response.json();

  return data.files || [];
}

async function findMasterCvFile() {
  const files = await listStorageFiles();

  const exactMatch = files.find(
    (file) => file.name === MASTER_CV_FILENAME
  );

  if (exactMatch) {
    return exactMatch;
  }

  const normalizedTarget =
    normalize(MASTER_CV_FILENAME).toLowerCase();

  const fallback = files.find(
    (file) =>
      normalize(file.name).toLowerCase() === normalizedTarget
  );

  if (fallback) {
    return fallback;
  }

  throw new Error(
    `MASTER_CV_NOT_FOUND: ${MASTER_CV_FILENAME}`
  );
}

async function downloadStorageFile(fileId) {
  const response = await appwriteRequest(
    `/storage/buckets/${encodeURIComponent(
      RESUME_BUCKET_ID
    )}/files/${encodeURIComponent(fileId)}/download`
  );

  return Buffer.from(await response.arrayBuffer());
}

async function uploadStorageFile(
  filename,
  buffer,
  contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
) {
  const form = new FormData();

  form.append(
    "fileId",
    "unique()"
  );

  form.append(
    "file",
    new Blob([buffer], {
      type: contentType
    }),
    filename
  );

  const response = await appwriteRequest(
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
   DOCX ZIP/XML HELPERS
   ========================================================= */

async function loadZip() {
  /*
   * Node 26 does not provide a built-in ZIP library.
   * The project already uses JSZip.
   */
  const module = await import("jszip");
  return module.default;
}

async function readDocxXml(buffer) {
  const JSZip = await loadZip();

  const zip = await JSZip.loadAsync(buffer);

  const documentEntry =
    zip.file("word/document.xml");

  if (!documentEntry) {
    throw new Error(
      "DOCX_DOCUMENT_XML_NOT_FOUND"
    );
  }

  const documentXml =
    await documentEntry.async("string");

  return {
    zip,
    documentXml
  };
}

async function writeDocxXml(zip, documentXml) {
  zip.file(
    "word/document.xml",
    documentXml
  );

  /*
   * Remove cached pagination information because it can become
   * stale after text edits.
   */
  const settingsEntry =
    zip.file("word/settings.xml");

  if (settingsEntry) {
    let settingsXml =
      await settingsEntry.async("string");

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

  /*
   * Remove cached page-break markers from document XML.
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

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE"
  });
}

/* =========================================================
   GEMINI
   ========================================================= */

async function callGemini(prompt) {
  requireEnv(
    "GEMINI_API_KEY",
    GEMINI_API_KEY
  );

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
      GEMINI_API_KEY
    )}`;

  const response = await fetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `GEMINI_${response.status}: ${errorText}`
    );
  }

  const data =
    await response.json();

  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error(
      "GEMINI_EMPTY_RESPONSE"
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    return JSON.parse(cleaned);
  }
}

/* =========================================================
   AI EDIT PLAN
   ========================================================= */

async function generateEditPlan({
  job,
  masterText,
  paragraphs,
  maxChars
}) {
  const paragraphData =
    paragraphs.map((p) => ({
      id: p.id,
      text: p.text
    }));

  const prompt = `
You are a resume content editor.

Your task is to create a STRICT content-edit plan for an existing
one-page master CV.

NON-NEGOTIABLE RULES:

1. The master CV format is immutable.
2. Never redesign the CV.
3. Never change fonts.
4. Never change font sizes.
5. Never change colors.
6. Never change margins.
7. Never change spacing.
8. Never change paragraph spacing.
9. Never change line spacing.
10. Never change section order.
11. Never add new sections.
12. Never invent experience, numbers, employers, responsibilities,
    technologies, achievements, or qualifications.
13. Never modify the Blue Star internship facts.
14. Never modify education facts.
15. Only existing content may be shortened, reordered conceptually,
    or rewritten for relevance.
16. The final visible text must not exceed the master's visible
    character count of ${maxChars}.
17. Rewritten text should normally be SHORTER than the original.
18. Prioritize content relevant to the target job.
19. Prefer removing low-value content rather than expanding content.
20. Preserve truthfulness.

TARGET JOB:
${JSON.stringify(job, null, 2)}

MASTER CV TEXT:
${masterText}

MASTER CV PARAGRAPHS:
${JSON.stringify(paragraphData, null, 2)}

Return ONLY valid JSON in this structure:

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
  "certificationsToRemove": ["P<number>"],
  "achievementsToRemove": ["P<number>"],
  "skillsToRemove": ["P<number>"],
  "extracurricularToRemove": ["P<number>"],
  "otherToRemove": ["P<number>"],
  "additionalRemovals": ["P<number>"]
}

If no change is necessary for a field, use null or [].

IMPORTANT:
- Never remove internship paragraphs.
- Never remove education paragraphs.
- Never invent paragraph IDs.
- Only use paragraph IDs present in the supplied paragraph list.
- Do not rewrite every project automatically.
- Only rewrite a paragraph when the new wording is materially more
  relevant to the target job.
- Every replacement must be equal to or shorter than the original
  paragraph text.
`;

  return callGemini(prompt);
}

/* =========================================================
   PARAGRAPH CLASSIFICATION
   ========================================================= */

function classifyParagraph(text) {
  const value = normalize(text).toLowerCase();

  if (!value) return "empty";

  if (
    value.includes("blue star") ||
    value.includes("marketing intern") ||
    value.includes("₹6.5") ||
    value.includes("6.5 cr") ||
    value.includes("17 product brochures") ||
    value.includes("100+ marketing")
  ) {
    return "protected-internship";
  }

  if (
    value.includes("pgdm") ||
    value.includes("imt nagpur") ||
    value.includes("b.com") ||
    value.includes("class xii") ||
    value.includes("class x") ||
    value.includes("cgpa") ||
    value.includes("73.86") ||
    value.includes("69.73") ||
    value.includes("62.38")
  ) {
    return "protected-education";
  }

  if (
    value.includes("certification") ||
    value.includes("hubspot") ||
    value.includes("great learning") ||
    value.includes("udemy") ||
    value.includes("deloitte") ||
    value.includes("be10x")
  ) {
    return "certification";
  }

  if (
    value.includes("runner-up") ||
    value.includes("rajya puraskar") ||
    value.includes("jila puraskar")
  ) {
    return "achievement";
  }

  if (
    value.includes("institution industry") ||
    value.includes("cubmaster") ||
    value.includes("bharat scouts") ||
    value.includes("contingent leader")
  ) {
    return "extracurricular";
  }

  if (
    value.includes("language") ||
    value.includes("interest") ||
    value.includes("brand storytelling") ||
    value.includes("geopolitics")
  ) {
    return "other";
  }

  return "other";
}

/* =========================================================
   SAFE EDIT VALIDATION
   ========================================================= */

function paragraphMap(paragraphs) {
  return new Map(
    paragraphs.map((p) => [
      p.id,
      p
    ])
  );
}

function isProtectedParagraph(paragraph) {
  const type =
    classifyParagraph(paragraph.text);

  return (
    type === "protected-internship" ||
    type === "protected-education"
  );
}

function validateReplacement(
  paragraph,
  replacement
) {
  if (!paragraph) return false;

  if (
    isProtectedParagraph(paragraph)
  ) {
    return false;
  }

  const oldLength =
    normalize(paragraph.text).length;

  const newLength =
    normalize(replacement).length;

  /*
   * Never allow AI-generated replacement text
   * to increase the length of the original paragraph.
   */
  if (newLength > oldLength) {
    return false;
  }

  if (newLength === 0) {
    return false;
  }

  return true;
}

/* =========================================================
   APPLY EDIT PLAN
   ========================================================= */

function applyEditPlan(
  documentXml,
  paragraphs,
  plan
) {
  const map =
    paragraphMap(paragraphs);

  let output =
    documentXml;

  /*
   * Summary
   */
  if (
    plan?.summary?.paragraphId &&
    typeof plan.summary.replacement === "string"
  ) {
    const paragraph =
      map.get(plan.summary.paragraphId);

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
   * Projects
   */
  if (
    Array.isArray(plan?.projects)
  ) {
    for (
      const project of plan.projects
    ) {
      if (
        !project?.paragraphId ||
        typeof project.replacement !== "string"
      ) {
        continue;
      }

      const paragraph =
        map.get(project.paragraphId);

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
   * Removal categories.
   */
  const removalIds = [
    ...(Array.isArray(plan?.certificationsToRemove)
      ? plan.certificationsToRemove
      : []),

    ...(Array.isArray(plan?.achievementsToRemove)
      ? plan.achievementsToRemove
      : []),

    ...(Array.isArray(plan?.skillsToRemove)
      ? plan.skillsToRemove
      : []),

    ...(Array.isArray(plan?.extracurricularToRemove)
      ? plan.extracurricularToRemove
      : []),

    ...(Array.isArray(plan?.otherToRemove)
      ? plan.otherToRemove
      : []),

    ...(Array.isArray(plan?.additionalRemovals)
      ? plan.additionalRemovals
      : [])
  ];

  /*
   * Remove only valid, non-protected paragraphs.
   */
  for (
    const paragraphId of removalIds
  ) {
    const paragraph =
      map.get(paragraphId);

    if (!paragraph) {
      continue;
    }

    if (
      isProtectedParagraph(paragraph)
    ) {
      continue;
    }

    /*
     * Do not remove structural/heading paragraphs.
     * This is intentionally conservative.
     */
    const text =
      normalize(paragraph.text);

    if (
      text.length === 0 ||
      text.length > 250
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
   DETERMINISTIC FALLBACK TRIMMING
   ========================================================= */

/*
 * The AI is not allowed to make the CV longer than the master.
 *
 * If it still exceeds the master content budget, this fallback
 * removes low-priority content from the actual paragraph map.
 *
 * It does NOT use hard-coded PIDs.
 */
function deterministicTrim(
  documentXml,
  maxChars
) {
  let currentXml =
    documentXml;

  let currentChars =
    visibleCharacterCount(currentXml);

  if (
    currentChars <= maxChars
  ) {
    return currentXml;
  }

  let paragraphs =
    getParagraphTexts(currentXml);

  /*
   * Low-priority sections are removed in this order.
   *
   * Education and internship are never touched.
   */
  const priorities = [
    "other",
    "extracurricular",
    "achievement",
    "certification"
  ];

  for (
    const priority of priorities
  ) {
    paragraphs =
      getParagraphTexts(currentXml);

    for (
      const paragraph of paragraphs
    ) {
      if (
        classifyParagraph(
          paragraph.text
        ) !== priority
      ) {
        continue;
      }

      if (
        isProtectedParagraph(paragraph)
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
        currentChars <= maxChars
      ) {
        return currentXml;
      }
    }
  }

  /*
   * Last-resort project removal.
   *
   * This is still content-only and does not modify formatting.
   */
  paragraphs =
    getParagraphTexts(currentXml);

  for (
    const paragraph of paragraphs
  ) {
    const type =
      classifyParagraph(
        paragraph.text
      );

    if (
      type === "protected-internship" ||
      type === "protected-education"
    ) {
      continue;
    }

    if (
      paragraph.text.length < 20
    ) {
      continue;
    }

    /*
     * Avoid deleting obvious section headings.
     */
    const lower =
      paragraph.text.toLowerCase();

    const isHeading =
      [
        "education",
        "experience",
        "internship",
        "projects",
        "certifications",
        "skills",
        "achievements",
        "extra-curricular",
        "extracurricular",
        "other information"
      ].includes(lower);

    if (isHeading) {
      continue;
    }

    /*
     * Only remove likely project/other content
     * at this final stage.
     */
    if (
      type !== "other"
    ) {
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
        currentChars <= maxChars
      ) {
        return currentXml;
      }
    }
  }

  return currentXml;
}

/* =========================================================
   DOCUMENT PROPERTIES
   ========================================================= */

async function updateDocumentProperties(zip) {
  const entry =
    zip.file("docProps/app.xml");

  if (!entry) {
    return;
  }

  let xml =
    await entry.async("string");

  /*
   * This is only metadata.
   * It is NOT treated as proof that the document is one page.
   */
  xml =
    xml.replace(
      /<Pages>[\s\S]*?<\/Pages>/,
      "<Pages>1</Pages>"
    );

  if (!xml.includes("<Pages>")) {
    xml =
      xml.replace(
        "</Properties>",
        "<Pages>1</Pages></Properties>"
      );
  }

  zip.file(
    "docProps/app.xml",
    xml
  );
}

/* =========================================================
   JOB RETRIEVAL
   ========================================================= */

function createTablesClient() {
  requireEnv(
    "APPWRITE_API_KEY",
    APPWRITE_API_KEY
  );

  const client =
    new Client()
      .setEndpoint(APPWRITE_ENDPOINT)
      .setProject(APPWRITE_PROJECT_ID)
      .setKey(APPWRITE_API_KEY);

  return new TablesDB(client);
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

  return result.rows || [];
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
    normalize(value).toLowerCase();

  return [
    "true",
    "yes",
    "eligible",
    "high",
    "medium"
  ].includes(normalized);
}

function getMatchScore(job) {
  const candidates = [
    job.match_score,
    job.matchScore,
    job.opportunity_score,
    job.opportunityScore,
    job.score
  ];

  for (
    const value of candidates
  ) {
    const number =
      Number(value);

    if (
      Number.isFinite(number)
    ) {
      return number;
    }
  }

  return 0;
}

function selectBestJob(jobs) {
  const eligible =
    jobs.filter((job) => {
      const eligibility =
        job.eligibility_status ??
        job.eligibilityStatus ??
        job.eligible;

      if (
        eligibility === undefined ||
        eligibility === null
      ) {
        return true;
      }

      return isTruthy(
        eligibility
      );
    });

  if (!eligible.length) {
    return null;
  }

  return eligible.sort(
    (a, b) =>
      getMatchScore(b) -
      getMatchScore(a)
  )[0];
}

/* =========================================================
   JOB TEXT
   ========================================================= */

function getJobDescription(job) {
  return (
    job.job_description ??
    job.jobDescription ??
    job.description ??
    job.jd_text ??
    job.jdText ??
    ""
  );
}

function compactJobForGemini(job) {
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
      getJobDescription(job),

    eligibility:
      job.eligibility_status ??
      job.eligibilityStatus ??
      job.eligible ??
      "",

    match_score:
      getMatchScore(job),

    match_reason:
      job.match_reason ??
      job.matchReason ??
      ""
  };
}

/* =========================================================
   MAIN RESUME CUSTOMIZATION FLOW
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
   * 1. Select eligible/highest-scoring job
   * -------------------------------------------------------
   */

  const jobs =
    await getJobs();

  const job =
    selectBestJob(jobs);

  if (!job) {
    return {
      status: "FAILED",
      error: "NO_ELIGIBLE_JOB_FOUND"
    };
  }

  /*
   * -------------------------------------------------------
   * 2. Locate the REAL master CV in Storage
   * -------------------------------------------------------
   */

  const masterFile =
    await findMasterCvFile();

  /*
   * -------------------------------------------------------
   * 3. Download master CV
   * -------------------------------------------------------
   */

  const masterBuffer =
    await downloadStorageFile(
      masterFile.$id
    );

  /*
   * -------------------------------------------------------
   * 4. Read DOCX
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
   * 5. Calculate master CV content budget
   * -------------------------------------------------------
   *
   * IMPORTANT:
   * This is the visible text count of the real master CV.
   *
   * We do NOT assume that 2600 / 3077 / 3200 characters
   * automatically equal one page.
   *
   * The master CV itself is the reference layout.
   */

  const masterVisibleText =
    extractVisibleText(
      documentXml
    );

  const masterVisibleChars =
    masterVisibleText.length;

  if (
    masterVisibleChars >
    ABSOLUTE_MAX_CHARS
  ) {
    throw new Error(
      `MASTER_CV_CONTENT_TOO_LARGE: ${masterVisibleChars} visible characters exceeds safety ceiling ${ABSOLUTE_MAX_CHARS}`
    );
  }

  const maxChars =
    masterVisibleChars;

  /*
   * -------------------------------------------------------
   * 6. Build paragraph map
   * -------------------------------------------------------
   */

  const paragraphs =
    getParagraphTexts(
      documentXml
    );

  /*
   * -------------------------------------------------------
   * 7. Ask Gemini for content-only edit plan
   * -------------------------------------------------------
   */

  const plan =
    await generateEditPlan({
      job:
        compactJobForGemini(job),

      masterText:
        masterVisibleText,

      paragraphs,

      maxChars
    });

  /*
   * -------------------------------------------------------
   * 8. Apply safe edits
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
   * 9. Verify visible content length
   * -------------------------------------------------------
   */

  let customizedChars =
    visibleCharacterCount(
      customizedXml
    );

  /*
   * -------------------------------------------------------
   * 10. Deterministic fallback trim
   * -------------------------------------------------------
   */

  if (
    customizedChars >
    maxChars
  ) {
    customizedXml =
      deterministicTrim(
        customizedXml,
        maxChars
      );

    customizedChars =
      visibleCharacterCount(
        customizedXml
      );
  }

  /*
   * -------------------------------------------------------
   * 11. Final content gate
   * -------------------------------------------------------
   */

  if (
    customizedChars >
    maxChars
  ) {
    throw new Error(
      `ONE_PAGE_GATE_FAILED: customized content remained at ${customizedChars} characters; master CV visible content is ${maxChars} characters. No CV was uploaded.`
    );
  }

  /*
   * -------------------------------------------------------
   * 12. Write customized DOCX
   * -------------------------------------------------------
   */

  let outputZip =
    await writeDocxXml(
      zip,
      customizedXml
    );

  /*
   * Update document metadata after the document XML
   * has been modified.
   */
  await updateDocumentProperties(
    outputZip
  );

  const finalBuffer =
    await outputZip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE"
    });

  /*
   * -------------------------------------------------------
   * 13. Upload ONLY the customized copy
   * -------------------------------------------------------
   *
   * Master CV is NEVER overwritten.
   */

  const timestamp =
    new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

  const jobTitle =
    normalize(
      job.title ??
      job.job_title ??
      "Job"
    )
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);

  const company =
    normalize(
      job.company ??
      job.company_name ??
      "Company"
    )
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);

  const outputFilename =
    `CUSTOMIZED-${company}-${jobTitle}-${timestamp}.docx`;

  const uploaded =
    await uploadStorageFile(
      outputFilename,
      finalBuffer
    );

  /*
   * -------------------------------------------------------
   * 14. Return success metadata
   * -------------------------------------------------------
   */

  return {
    status: "SUCCESS",

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
        getMatchScore(job)
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
        maxChars,

      actual_visible_characters:
        customizedChars,

      remaining_capacity:
        Math.max(
          0,
          maxChars -
            customizedChars
        )
    },

    note:
      "The character gate is a content-safety proxy. It does not by itself prove rendered pagination is exactly one page."
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
    const result =
      await customizeResume();

    return res.json(
      result
    );
  } catch (error) {
    console.error(
      "RESUME_CUSTOMIZATION_ERROR",
      error
    );

    return res.json(
      {
        status: "FAILED",

        error:
          error?.message ??
          String(error)
      },
      500
    );
  }
}
