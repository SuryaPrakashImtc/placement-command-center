import {
  Client,
  TablesDB,
  Storage,
  ID,
  Query
} from 'node-appwrite';

import JSZip from 'jszip';

const DATABASE_ID =
  '6aa03d1800119759c9bb';

const JOBS_TABLE_ID =
  'jobs';

const RESUME_BUCKET_ID =
  'resume-files';

const MASTER_FILENAME =
  'MASTER CV FP(5).docx';

const GEMINI_MODEL =
  'gemini-2.5-flash-lite';

// =======================================================
// LOCKED MASTER CV MAP
// =======================================================
//
// These are the exact paragraph indexes from the current
// master CV.
//
// We change CONTENT only.
// We preserve the existing Word document structure,
// formatting, styles, headers, margins, etc.
//
// =======================================================

const PROJECTS = {
  22: {
    title:
      'Development of a Technician-Friendly Installation Guide',
    bullet: 23
  },

  24: {
    title:
      'General Mills — Marketing & Commercial Intelligence Dashboard',
    bullet: 25
  },

  26: {
    title:
      'AI-Driven B2B Prospecting & Client Acquisition — The Insignia Consultant',
    bullet: 27
  },

  28: {
    title:
      'Consumer Research on Sunscreen Brand Switching',
    bullet: 29
  },

  30: {
    title:
      'Customer Purchase Behaviour Analytics Dashboard',
    bullet: 31
  }
};

const CERTIFICATIONS = {
  33:
    'Inbound Marketing Certification – HubSpot Academy, 2026',

  34:
    'Marketing & Retail Analytics – Great Learning, 2026',

  35:
    'Smart Marketing with Price Psychology – Udemy, 2025',

  36:
    'AI Tools & ChatGPT Workshop – BE10X, 2026',

  37:
    'Data Analytics Job Simulation – Deloitte (Forage), 2026'
};

const ACHIEVEMENTS = {
  45:
    'Runner-up – Concord, Intra-College Competition, IMT Nagpur (2026)',

  46:
    "Rajya Puraskar Award – Conferred by the Hon'ble Governor of West Bengal for achieving the Rajya Puraskar level in Bharat Scouts & Guides",

  47:
    'Jila Puraskar – West Calcutta District Association, Bharat Scouts & Guides'
};


// =======================================================
// XML HELPERS
// =======================================================

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractParagraphs(xml) {
  return [
    ...xml.matchAll(
      /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
    )
  ].map(match => match[0]);
}

function paragraphText(paragraphXml) {
  return [
    ...paragraphXml.matchAll(
      /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
    )
  ]
    .map(match =>
      decodeXml(match[1])
    )
    .join('');
}

function runStyle(runXml) {
  const match =
    runXml.match(
      /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/
    );

  return match
    ? match[0]
    : '';
}

function replaceParagraphText(
  paragraphXml,
  newText
) {
  const runs = [
    ...paragraphXml.matchAll(
      /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g
    )
  ];

  if (runs.length === 0) {
    return {
      xml: paragraphXml,
      changed: false
    };
  }

  // We only rewrite paragraphs whose runs share the
  // same formatting. This prevents accidental formatting
  // changes to mixed-format paragraphs.

  const styles =
    runs.map(run =>
      runStyle(run[0])
    );

  const uniqueStyles =
    new Set(styles);

  if (uniqueStyles.size > 1) {
    return {
      xml: paragraphXml,
      changed: false
    };
  }

  const properties =
    runStyle(
      runs[0][0]
    );

  const newRun =
    `<w:r>` +
    properties +
    `<w:t xml:space="preserve">` +
    escapeXml(newText) +
    `</w:t>` +
    `</w:r>`;

  const runRegex =
    /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;

  const cleaned =
    paragraphXml.replace(
      runRegex,
      ''
    );

  return {
    xml:
      cleaned.replace(
        /(<w:p\b[^>]*>)/,
        `$1${newRun}`
      ),

    changed: true
  };
}


// =======================================================
// FIND MASTER CV
// =======================================================

async function findMasterFile(
  storage
) {
  const response =
    await storage.listFiles({
      bucketId:
        RESUME_BUCKET_ID,

      queries: [
        Query.equal(
          'name',
          MASTER_FILENAME
        ),

        Query.limit(10)
      ]
    });

  const file =
    response.files?.find(
      item =>
        item.name ===
        MASTER_FILENAME
    );

  if (!file) {
    throw new Error(
      `Master CV "${MASTER_FILENAME}" was not found in bucket "${RESUME_BUCKET_ID}".`
    );
  }

  return file;
}


// =======================================================
// DOWNLOAD MASTER CV
// =======================================================

async function downloadMasterCV(
  storage,
  fileId
) {
  const data =
    await storage.getFileDownload({
      bucketId:
        RESUME_BUCKET_ID,

      fileId
    });

  return Buffer.from(data);
}


// =======================================================
// FIND TARGET JOB
// =======================================================

async function findTargetJob(
  tablesDB
) {

  // ---------------------------------------------------
  // Preferred:
  // Eligible + High match + Priority
  // ---------------------------------------------------

  let response =
    await tablesDB.listRows({
      databaseId:
        DATABASE_ID,

      tableId:
        JOBS_TABLE_ID,

      queries: [
        Query.equal(
          'eligibility_status',
          'ELIGIBLE'
        ),

        Query.equal(
          'match_status',
          'HIGH_MATCH'
        ),

        Query.equal(
          'opportunity_status',
          'PRIORITY'
        ),

        Query.orderDesc(
          'opportunity_score'
        ),

        Query.limit(1)
      ]
    });

  if (
    response.rows?.length > 0
  ) {
    return response.rows[0];
  }

  // ---------------------------------------------------
  // Fallback:
  // Eligible + High match
  // ---------------------------------------------------

  response =
    await tablesDB.listRows({
      databaseId:
        DATABASE_ID,

      tableId:
        JOBS_TABLE_ID,

      queries: [
        Query.equal(
          'eligibility_status',
          'ELIGIBLE'
        ),

        Query.equal(
          'match_status',
          'HIGH_MATCH'
        ),

        Query.orderDesc(
          'opportunity_score'
        ),

        Query.limit(1)
      ]
    });

  if (
    response.rows?.length > 0
  ) {
    return response.rows[0];
  }

  // ---------------------------------------------------
  // Final fallback:
  // Any eligible job
  // ---------------------------------------------------

  response =
    await tablesDB.listRows({
      databaseId:
        DATABASE_ID,

      tableId:
        JOBS_TABLE_ID,

      queries: [
        Query.equal(
          'eligibility_status',
          'ELIGIBLE'
        ),

        Query.orderDesc(
          'opportunity_score'
        ),

        Query.limit(1)
      ]
    });

  if (
    response.rows?.length > 0
  ) {
    return response.rows[0];
  }

  throw new Error(
    'No eligible job was found for Resume Customization.'
  );
}


// =======================================================
// READ MASTER DOCX
// =======================================================

async function readMasterDocument(
  masterBuffer
) {
  const zip =
    await JSZip.loadAsync(
      masterBuffer
    );

  const documentFile =
    zip.file(
      'word/document.xml'
    );

  if (!documentFile) {
    throw new Error(
      'word/document.xml was not found in the master CV.'
    );
  }

  const xml =
    await documentFile.async(
      'string'
    );

  return {
    zip,
    xml
  };
}


// =======================================================
// GEMINI
// =======================================================

async function callGemini(
  apiKey,
  prompt
) {

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const response =
    await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          'x-goog-api-key':
            apiKey
        },

        body:
          JSON.stringify({

            contents: [
              {
                role: 'user',

                parts: [
                  {
                    text:
                      prompt
                  }
                ]
              }
            ],

            generationConfig: {

              temperature:
                0.1,

              maxOutputTokens:
                3000,

              responseMimeType:
                'application/json',

              responseSchema: {

                type:
                  'OBJECT',

                properties: {

                  summary: {
                    type:
                      'STRING'
                  },

                  projectsToKeep: {
                    type:
                      'ARRAY',

                    items: {
                      type:
                        'INTEGER'
                    }
                  },

                  certificationsToKeep: {
                    type:
                      'ARRAY',

                    items: {
                      type:
                        'INTEGER'
                    }
                  },

                  achievementsToKeep: {
                    type:
                      'ARRAY',

                    items: {
                      type:
                        'INTEGER'
                    }
                  },

                  projectRewrites: {

                    type:
                      'ARRAY',

                    items: {

                      type:
                        'OBJECT',

                      properties: {

                        id: {
                          type:
                            'INTEGER'
                        },

                        text: {
                          type:
                            'STRING'
                        }
                      },

                      required: [
                        'id',
                        'text'
                      ]
                    }
                  }
                },

                required: [
                  'summary',
                  'projectsToKeep',
                  'certificationsToKeep',
                  'achievementsToKeep',
                  'projectRewrites'
                ]
              }
            }
          })
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Gemini API ${response.status}: ${responseText.slice(0, 500)}`
    );
  }

  let data;

  try {
    data =
      JSON.parse(
        responseText
      );
  } catch {
    throw new Error(
      'Gemini API returned invalid JSON.'
    );
  }

  const text =
    data
      ?.candidates?.[0]
      ?.content?.parts
      ?.map(
        part =>
          part.text || ''
      )
      .join('')
      .trim();

  if (!text) {
    throw new Error(
      'Gemini returned no content.'
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'Gemini returned invalid structured JSON.'
    );
  }
}


// =======================================================
// GEMINI PROMPT
// =======================================================

function buildPrompt(
  job,
  paragraphTexts
) {

  const projectData =
    Object.entries(
      PROJECTS
    ).map(
      ([id, project]) => ({
        id:
          Number(id),

        title:
          project.title,

        content:
          paragraphTexts[
            project.bullet
          ]
      })
    );

  const certificationData =
    Object.entries(
      CERTIFICATIONS
    ).map(
      ([id, text]) => ({
        id:
          Number(id),

        text
      })
    );

  const achievementData =
    Object.entries(
      ACHIEVEMENTS
    ).map(
      ([id, text]) => ({
        id:
          Number(id),

        text
      })
    );

  return `
You are a strict Resume Customization Agent.

You are customizing a LOCKED MASTER CV.

THE MASTER CV IS THE SOURCE OF TRUTH.

ABSOLUTE RULES:

1. The final CV must be exactly ONE PAGE.
2. Never redesign the CV.
3. Never change fonts.
4. Never change font sizes.
5. Never change margins.
6. Never change colors.
7. Never change spacing or visual styling intentionally.
8. Never change section headings.
9. Never change section order.
10. Never create a new section.
11. Never invent a skill.
12. Never invent experience.
13. Never invent metrics.
14. Never invent employers.
15. Never invent achievements.
16. Never invent qualifications.
17. Never change facts.
18. Only use evidence already present in the master CV.
19. Content can be removed.
20. Content can be rewritten when the substance remains truthful.
21. Preserve the master CV's formatting by changing text only.
22. The internship section and education section must remain intact.
23. Do not rewrite internship bullets.
24. Do not rewrite education.
25. Skills may be shortened only by removing less relevant skill content, never by inventing or changing facts.
26. The output must remain a professional one-page resume.

TARGET JOB

Title:
${job.job_title}

Company:
${job.company_name}

Location:
${job.location}

Function:
${job.function}

Department:
${job.department}

Experience:
${job.experience_required}

Education:
${job.education_required}

Salary:
${job.salary_range}

JOB DESCRIPTION:

${job.job_description}


MASTER CV PROJECTS:

${JSON.stringify(
  projectData,
  null,
  2
)}


MASTER CV CERTIFICATIONS:

${JSON.stringify(
  certificationData,
  null,
  2
)}


MASTER CV ACHIEVEMENTS:

${JSON.stringify(
  achievementData,
  null,
  2
)}


TASK

Return ONLY a JSON edit plan.

SUMMARY:

Rewrite the Professional Summary for the target role.

Maximum:
45 words.

PROJECTS:

Select exactly 2 or 3 projects.

Choose the projects with the strongest evidence for the target role.

CERTIFICATIONS:

Select exactly 3 or 4 certifications.

ACHIEVEMENTS:

Select exactly 1 or 2 achievements.

PROJECT REWRITES:

Rewrite selected project bullets only when useful.

Each rewritten project bullet:
- must remain factually true
- must use only information in the master CV
- must be concise
- must not exceed 220 characters
- must improve relevance to the target job
- must not introduce new claims

DO NOT MODIFY:
- internship bullets
- education
- section headings
- layout
- formatting
- colors
- fonts
- margins

The downstream document engine will remove low-priority content to satisfy the one-page requirement.
`;
}


// =======================================================
// VALIDATE GEMINI PLAN
// =======================================================

function validatePlan(
  plan
) {

  const projectIds =
    Array.isArray(
      plan.projectsToKeep
    )
      ? plan.projectsToKeep
          .map(Number)
          .filter(
            id =>
              Boolean(
                PROJECTS[id]
              )
          )
      : [];

  const certificationIds =
    Array.isArray(
      plan.certificationsToKeep
    )
      ? plan.certificationsToKeep
          .map(Number)
          .filter(
            id =>
              Boolean(
                CERTIFICATIONS[id]
              )
          )
      : [];

  const achievementIds =
    Array.isArray(
      plan.achievementsToKeep
    )
      ? plan.achievementsToKeep
          .map(Number)
          .filter(
            id =>
              Boolean(
                ACHIEVEMENTS[id]
              )
          )
      : [];

  // ---------------------------------------------------
  // Safe fallbacks
  // ---------------------------------------------------

  const finalProjects =
    projectIds.length >= 2
      ? projectIds.slice(0, 3)
      : [24, 26, 30];

  const finalCertifications =
    certificationIds.length >= 3
      ? certificationIds.slice(0, 4)
      : [33, 34, 36];

  const finalAchievements =
    achievementIds.length >= 1
      ? achievementIds.slice(0, 2)
      : [45, 46];

  // ---------------------------------------------------
  // Summary
  // ---------------------------------------------------

  let summary =
    String(
      plan.summary || ''
    )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  const summaryWords =
    summary.split(/\s+/)
      .filter(Boolean);

  if (
    summaryWords.length > 45
  ) {

    summary =
      summaryWords
        .slice(0, 45)
        .join(' ');
  }

  // ---------------------------------------------------
  // Project rewrites
  // ---------------------------------------------------

  const allowedProjects =
    new Set(
      finalProjects
    );

  const projectRewrites =
    Array.isArray(
      plan.projectRewrites
    )
      ? plan.projectRewrites
          .filter(
            item =>
              allowedProjects.has(
                Number(item.id)
              )
          )
          .map(item => {

            let text =
              String(
                item.text || ''
              )
                .replace(
                  /\s+/g,
                  ' '
                )
                .trim();

            if (
              text.length > 220
            ) {

              text =
                text
                  .slice(
                    0,
                    220
                  )
                  .replace(
                    /\s+\S*$/,
                    ''
                  );
            }

            return {
              id:
                Number(item.id),

              text
            };
          })
          .filter(
            item =>
              Boolean(
                item.text
              )
          )
      : [];

  return {

    summary,

    projectsToKeep:
      finalProjects,

    certificationsToKeep:
      finalCertifications,

    achievementsToKeep:
      finalAchievements,

    projectRewrites
  };
}


// =======================================================
// ONE-PAGE CONTENT BUDGET
// =======================================================
//
// The master CV is currently 2 pages.
//
// We preserve the visual template and create room
// by removing content, NOT shrinking formatting.
//
// =======================================================

function applyContentBudget(
  originalXml,
  plan
) {

  const paragraphs =
    extractParagraphs(
      originalXml
    );

  const removeIndexes =
    new Set([

      // Remove 12th + date.
      11,
      12,

      // Remove 10th + date.
      13,
      14,

      // Remove Office Productivity skill.
      42,

      // Remove entire extracurricular section.
      48,
      49,
      50,
      51,
      52,
      53,
      54,

      // Remove Other Information section.
      56,
      57,
      58
    ]);

  // ---------------------------------------------------
  // Keep selected projects
  // ---------------------------------------------------

  const projectKeep =
    new Set(
      plan.projectsToKeep
    );

  for (
    const [
      id,
      project
    ]
    of Object.entries(
      PROJECTS
    )
  ) {

    const numericId =
      Number(id);

    if (
      !projectKeep.has(
        numericId
      )
    ) {

      removeIndexes.add(
        numericId
      );

      removeIndexes.add(
        project.bullet
      );
    }
  }

  // ---------------------------------------------------
  // Keep selected certifications
  // ---------------------------------------------------

  const certificationKeep =
    new Set(
      plan.certificationsToKeep
    );

  for (
    const id
    of Object.keys(
      CERTIFICATIONS
    )
  ) {

    if (
      !certificationKeep.has(
        Number(id)
      )
    ) {

      removeIndexes.add(
        Number(id)
      );
    }
  }

  // ---------------------------------------------------
  // Keep selected achievements
  // ---------------------------------------------------

  const achievementKeep =
    new Set(
      plan.achievementsToKeep
    );

  for (
    const id
    of Object.keys(
      ACHIEVEMENTS
    )
  ) {

    if (
      !achievementKeep.has(
        Number(id)
      )
    ) {

      removeIndexes.add(
        Number(id)
      );
    }
  }

  // ---------------------------------------------------
  // Rewrite map
  // ---------------------------------------------------

  const rewriteMap =
    new Map();

  // Professional Summary
  rewriteMap.set(
    5,
    plan.summary
  );

  // Selected project bullets
  for (
    const rewrite
    of plan.projectRewrites
  ) {

    const project =
      PROJECTS[
        Number(
          rewrite.id
        )
      ];

    if (!project) {
      continue;
    }

    rewriteMap.set(
      project.bullet,
      rewrite.text
    );
  }

  // ---------------------------------------------------
  // Rebuild paragraph sequence
  // ---------------------------------------------------

  const outputParagraphs =
    paragraphs
      .map(
        (xml, index) => ({
          xml,
          index
        })
      )
      .filter(
        ({ index }) =>
          !removeIndexes.has(
            index
          )
      )
      .map(
        ({
          xml,
          index
        }) => {

          if (
            !rewriteMap.has(
              index
            )
          ) {

            return xml;
          }

          const replacement =
            rewriteParagraphTextSafe(
              xml,
              rewriteMap.get(
                index
              )
            );

          return replacement;
        }
      );

  // ---------------------------------------------------
  // Remove stale rendered-page marker.
  //
  // It is not an intentional page break; it is Word's
  // previously-rendered pagination marker.
  // ---------------------------------------------------

  let outputXml =
    originalXml.replace(
      /<w:lastRenderedPageBreak\/>/g,
      ''
    );

  let cursor = 0;

  outputXml =
    outputXml.replace(
      /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,
      () => {

        const replacement =
          outputParagraphs[
            cursor
          ];

        cursor++;

        return (
          replacement !== undefined
            ? replacement
            : ''
        );
      }
    );

  return outputXml;
}

function rewriteParagraphTextSafe(
  paragraphXml,
  newText
) {

  const result =
    replaceParagraphText(
      paragraphXml,
      newText
    );

  return result.changed
    ? result.xml
    : paragraphXml;
}


// =======================================================
// CREATE CUSTOMIZED DOCX
// =======================================================

async function createCustomizedCV(
  masterBuffer,
  plan
) {

  const {
    zip,
    xml
  } =
    await readMasterDocument(
      masterBuffer
    );

  const updatedXml =
    applyContentBudget(
      xml,
      plan
    );

  zip.file(
    'word/document.xml',
    updatedXml
  );

  return await zip.generateAsync({
    type:
      'nodebuffer',

    compression:
      'DEFLATE'
  });
}


// =======================================================
// UPLOAD CUSTOMIZED DOCX
// =======================================================
//
// We intentionally do NOT use InputFile.
// Instead we use the Appwrite Storage REST API.
//
// This avoids the InputFile import problem in the current
// node-appwrite environment.
//
// =======================================================

async function uploadFileToAppwrite(
  endpoint,
  projectId,
  apiKey,
  outputBuffer,
  filename
) {

  const form =
    new FormData();

  form.append(
    'fileId',
    ID.unique()
  );

  form.append(
    'file',
    new Blob(
      [
        outputBuffer
      ],
      {
        type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }
    ),
    filename
  );

  form.append(
    'folder',
    'customized'
  );

  const url =
    `${endpoint}/storage/buckets/${encodeURIComponent(
      RESUME_BUCKET_ID
    )}/files`;

  const response =
    await fetch(
      url,
      {
        method:
          'POST',

        headers: {
          'X-Appwrite-Project':
            projectId,

          'X-Appwrite-Key':
            apiKey,

          'X-Appwrite-Response-Format':
            '2.3.0'
        },

        body:
          form
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {

    throw new Error(
      `Appwrite file upload ${response.status}: ${responseText.slice(0, 500)}`
    );
  }

  let file;

  try {

    file =
      JSON.parse(
        responseText
      );

  } catch {

    throw new Error(
      'Appwrite file upload returned invalid JSON.'
    );
  }

  return file;
}


// =======================================================
// MAIN
// =======================================================

export default async ({
  req,
  res,
  log,
  error
}) => {

  try {

    // ---------------------------------------------------
    // ENVIRONMENT
    // ---------------------------------------------------

    const appwriteKey =
      process.env
        .JOB_AUTOMATION_API_KEY;

    const geminiKey =
      process.env
        .GEMINI_API_KEY;

    const endpoint =
      process.env
        .APPWRITE_FUNCTION_API_ENDPOINT;

    const projectId =
      process.env
        .APPWRITE_FUNCTION_PROJECT_ID;

    if (!appwriteKey) {

      throw new Error(
        'JOB_AUTOMATION_API_KEY is missing.'
      );
    }

    if (!geminiKey) {

      throw new Error(
        'GEMINI_API_KEY is missing.'
      );
    }

    if (!endpoint) {

      throw new Error(
        'APPWRITE_FUNCTION_API_ENDPOINT is missing.'
      );
    }

    if (!projectId) {

      throw new Error(
        'APPWRITE_FUNCTION_PROJECT_ID is missing.'
      );
    }

    // ---------------------------------------------------
    // APPWRITE CLIENTS
    // ---------------------------------------------------

    const client =
      new Client()
        .setEndpoint(
          endpoint
        )
        .setProject(
          projectId
        )
        .setKey(
          appwriteKey
        );

    const tablesDB =
      new TablesDB(
        client
      );

    const storage =
      new Storage(
        client
      );

    // ---------------------------------------------------
    // INPUT
    // ---------------------------------------------------

    let input = {};

    try {

      if (
        req.bodyJson
      ) {

        input =
          req.bodyJson;

      } else if (
        req.body
      ) {

        input =
          JSON.parse(
            req.body
          );
      }

    } catch {

      input = {};
    }

    // ---------------------------------------------------
    // TARGET JOB
    // ---------------------------------------------------

    let job;

    if (
      input.jobId
    ) {

      job =
        await tablesDB.getRow({
          databaseId:
            DATABASE_ID,

          tableId:
            JOBS_TABLE_ID,

          rowId:
            String(
              input.jobId
            )
        });

    } else {

      job =
        await findTargetJob(
          tablesDB
        );
    }

    // ---------------------------------------------------
    // MASTER CV
    // ---------------------------------------------------

    const masterFile =
      await findMasterFile(
        storage
      );

    const masterBuffer =
      await downloadMasterCV(
        storage,
        masterFile.$id
      );

    // ---------------------------------------------------
    // READ MASTER TEXT
    // ---------------------------------------------------

    const {
      xml
    } =
      await readMasterDocument(
        masterBuffer
      );

    const paragraphs =
      extractParagraphs(
        xml
      );

    const paragraphTexts =
      paragraphs.map(
        paragraph =>
          paragraphText(
            paragraph
          )
      );

    // ---------------------------------------------------
    // GEMINI
    // ---------------------------------------------------

    const prompt =
      buildPrompt(
        job,
        paragraphTexts
      );

    const rawPlan =
      await callGemini(
        geminiKey,
        prompt
      );

    const plan =
      validatePlan(
        rawPlan
      );

    // ---------------------------------------------------
    // CREATE CUSTOMIZED CV
    // ---------------------------------------------------

    const outputBuffer =
      await createCustomizedCV(
        masterBuffer,
        plan
      );

    // ---------------------------------------------------
    // FILE NAME
    // ---------------------------------------------------

    const safeCompany =
      String(
        job.company_name ||
        'Company'
      )
        .replace(
          /[^a-zA-Z0-9]+/g,
          '_'
        )
        .replace(
          /^_+|_+$/g,
          ''
        )
        .slice(
          0,
          50
        );

    const safeTitle =
      String(
        job.job_title ||
        'Role'
      )
        .replace(
          /[^a-zA-Z0-9]+/g,
          '_'
        )
        .replace(
          /^_+|_+$/g,
          ''
        )
        .slice(
          0,
          60
        );

    const date =
      new Date()
        .toISOString()
        .slice(
          0,
          10
        );

    const filename =
      `CV_${safeCompany}_${safeTitle}_${date}.docx`;

    // ---------------------------------------------------
    // SAVE
    // ---------------------------------------------------

    const outputFile =
      await uploadFileToAppwrite(
        endpoint,
        projectId,
        appwriteKey,
        outputBuffer,
        filename
      );

    // ---------------------------------------------------
    // RESULT
    // ---------------------------------------------------

    return res.json({

      status:
        'SUCCESS',

      job: {

        id:
          job.$id,

        title:
          job.job_title,

        company:
          job.company_name,

        matchStatus:
          job.match_status,

        opportunityScore:
          job.opportunity_score
      },

      customization: {

        summary:
          plan.summary,

        projectsKept:
          plan.projectsToKeep,

        certificationsKept:
          plan.certificationsToKeep,

        achievementsKept:
          plan.achievementsToKeep,

        projectRewrites:
          plan.projectRewrites,

        onePageContentBudget:
          true,

        formattingChanged:
          false
      },

      output: {

        fileId:
          outputFile.$id,

        fileName:
          filename,

        bucketId:
          RESUME_BUCKET_ID
      }

    });

  } catch (err) {

    error(
      `Resume customization failed: ${err.message}`
    );

    return res.json({

      status:
        'FAILED',

      error:
        err.message

    }, 500);
  }
};
