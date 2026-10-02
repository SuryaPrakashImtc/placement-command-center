import {
  Client,
  TablesDB,
  Storage,
  ID,
  Query
} from 'node-appwrite';

import { InputFile } from 'node-appwrite/file';

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
// MASTER CV PARAGRAPH MAP
// =======================================================
//
// The master CV is intentionally treated as a LOCKED
// TEMPLATE. These paragraph positions correspond to the
// uploaded master CV.
//
// We do not redesign anything.
// We only remove or replace text.
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
  const texts = [
    ...paragraphXml.matchAll(
      /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
    )
  ].map(match =>
    decodeXml(match[1])
  );

  return texts.join('');
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

  /*
    We only rewrite paragraphs whose runs all use
    the same formatting.

    This protects bold/italic mixed formatting in
    internship bullets, achievements, skill labels, etc.
  */

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

  const firstRun =
    runs[0][0];

  const properties =
    runStyle(firstRun);

  const newRun =
    `<w:r>` +
    properties +
    `<w:t xml:space="preserve">` +
    escapeXml(newText) +
    `</w:t>` +
    `</w:r>`;

  const runRegex =
    /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;

  return {
    xml:
      paragraphXml.replace(
        runRegex,
        () => ''
      ).replace(
        /(<w:p\b[^>]*>)/,
        `$1${newRun}`
      ),

    changed: true
  };
}


// =======================================================
// REMOVE PARAGRAPHS
// =======================================================

function removeParagraphsByIndex(
  paragraphs,
  removeIndexes
) {

  return paragraphs
    .filter(
      (_, index) =>
        !removeIndexes.has(index)
    );
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
      `Master CV "${MASTER_FILENAME}" was not found in Appwrite Storage bucket "${RESUME_BUCKET_ID}".`
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

  /*
    Prefer a high-match + priority job.
  */

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
    response.rows?.length
  ) {
    return response.rows[0];
  }

  /*
    Fallback to any high-match eligible job.
  */

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
    response.rows?.length
  ) {
    return response.rows[0];
  }

  /*
    Final fallback to any eligible job.
  */

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
    response.rows?.length
  ) {
    return response.rows[0];
  }

  throw new Error(
    'No eligible job was found for Resume Customization.'
  );
}


// =======================================================
// EXTRACT MASTER CV TEXT
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
      'word/document.xml not found in master CV.'
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
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response =
    await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
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
                0.15,

              maxOutputTokens:
                3000,

              responseMimeType:
                'application/json',

              responseSchema: {

                type:
                  'OBJECT',

                properties: {

                  summary: {
                    type: 'STRING'
                  },

                  projectsToKeep: {
                    type: 'ARRAY',

                    items: {
                      type:
                        'INTEGER'
                    }
                  },

                  certificationsToKeep: {
                    type: 'ARRAY',

                    items: {
                      type:
                        'INTEGER'
                    }
                  },

                  achievementsToKeep: {
                    type: 'ARRAY',

                    items: {
                      type:
                        'INTEGER'
                    }
                  },

                  projectRewrites: {
                    type: 'ARRAY',

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

  const data =
    JSON.parse(
      responseText
    );

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();

  if (!text) {
    throw new Error(
      'Gemini returned no content.'
    );
  }

  try {
    return JSON.parse(
      text
    );
  } catch {
    throw new Error(
      'Gemini returned invalid JSON.'
    );
  }
}


// =======================================================
// BUILD GEMINI PROMPT
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
You are the Resume Customization Agent.

You are editing a LOCKED master CV.

ABSOLUTE RULES:

1. The CV must remain exactly the same visual template.
2. Never redesign the CV.
3. Never change fonts.
4. Never change font sizes.
5. Never change margins.
6. Never change colors.
7. Never change section headings.
8. Never change section order.
9. Never add a new section.
10. Never invent experience, skills, numbers, employers, achievements or qualifications.
11. Only use evidence already present in the master CV.
12. The final CV MUST be ONE PAGE.
13. Content removal is allowed.
14. Content rewriting is allowed only to improve relevance and clarity.
15. Preserve the truth and substance of every claim.

TARGET JOB:

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

FULL JOB DESCRIPTION:
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

YOUR TASK:

Return a JSON edit plan.

SUMMARY:
Rewrite the Professional Summary specifically for this job.

Maximum:
45 words.

PROJECTS:
Select exactly 3 project IDs that provide the strongest evidence for this job.

CERTIFICATIONS:
Select exactly 4 certification IDs.

ACHIEVEMENTS:
Select exactly 2 achievement IDs.

PROJECT REWRITES:
You may rewrite selected project bullet paragraphs when useful.

A rewritten project bullet must:
- remain factually identical in substance
- use only existing evidence
- be concise
- be no more than 220 characters
- improve alignment with the target job

Do not rewrite a project bullet when no rewrite is needed.

IMPORTANT:
Do NOT modify internship bullets in this task.
Do NOT modify education.
Do NOT modify skills.
Do NOT modify achievements.
Do NOT modify certifications.

The application layer will remove lower-priority content automatically.
`;
}


// =======================================================
// VALIDATE AI PLAN
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

  let summary =
    String(
      plan.summary || ''
    ).replace(
      /\s+/g,
      ' '
    ).trim();

  /*
    Hard safety limit for the summary.
  */

  if (
    summary.length > 420
  ) {
    summary =
      summary
        .split(/\s+/)
        .slice(0, 45)
        .join(' ');
  }

  /*
    If Gemini returns an invalid selection,
    use safe fallback selections.
  */

  const finalProjects =
    projectIds.length >= 3
      ? projectIds.slice(0, 3)
      : [24, 26, 30];

  const finalCertifications =
    certificationIds.length >= 4
      ? certificationIds.slice(0, 4)
      : [33, 34, 36, 37];

  const finalAchievements =
    achievementIds.length >= 2
      ? achievementIds.slice(0, 2)
      : [45, 46];

  const allowedProjectIds =
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
              allowedProjectIds.has(
                Number(item.id)
              )
          )
          .map(
            item => {

              let text =
                String(
                  item.text || ''
                )
                  .replace(
                    /\s+/g,
                    ' '
                  )
                  .trim();

              /*
                Reject overly long AI rewrites.
                Keeping the master text is safer
                than allowing content overflow.
              */

              if (
                text.length > 220
              ) {
                text = '';
              }

              return {
                id:
                  Number(item.id),

                text
              };
            }
          )
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
// APPLY ONE-PAGE CONTENT BUDGET
// =======================================================

function applyContentBudget(
  originalXml,
  plan
) {

  const paragraphs =
    extractParagraphs(
      originalXml
    );

  /*
    MANDATORY REMOVALS

    These were validated against the exact master
    CV to create a one-page version without changing
    the visual template.
  */

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

      // Remove complete extracurricular section.
      48,
      49,
      50,
      51,
      52,
      53,
      54,

      // Remove complete Other Information section.
      56,
      57,
      58
    ]);

  /*
    Keep exactly three projects.
  */

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

  /*
    Keep exactly four certifications.
  */

  const certKeep =
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
      !certKeep.has(
        Number(id)
      )
    ) {

      removeIndexes.add(
        Number(id)
      );
    }
  }

  /*
    Keep exactly two achievements.
  */

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

  /*
    First remove the content we don't need.
  */

  const keptParagraphs =
    paragraphs.filter(
      (_, index) =>
        !removeIndexes.has(
          index
        )
    );

  /*
    Rewriting is done after filtering.

    We identify paragraphs by their original text,
    not by their shifted position.
  */

  const rewriteMap =
    new Map();

  /*
    Summary paragraph.
  */

  rewriteMap.set(
    5,
    plan.summary
  );

  /*
    Selected project bullets.
  */

  for (
    const rewrite
    of plan.projectRewrites
  ) {

    const project =
      PROJECTS[
        Number(rewrite.id)
      ];

    if (!project) {
      continue;
    }

    rewriteMap.set(
      project.bullet,
      rewrite.text
    );
  }

  /*
    Build a map from the text of each original
    paragraph to its original index.

    Master CV paragraphs are immutable, so this
    is safe for this locked-template architecture.
  */

  const originalEntries =
    paragraphs.map(
      (xml, index) => ({
        xml,
        index
      })
    );

  const rewrittenKept =
    originalEntries
      .filter(
        ({ index }) =>
          !removeIndexes.has(
            index
          )
      )
      .map(
        ({ xml, index }) => {

          if (
            !rewriteMap.has(
              index
            )
          ) {

            return xml;
          }

          const newText =
            rewriteMap.get(
              index
            );

          const result =
            replaceParagraphText(
              xml,
              newText
            );

          /*
            If the paragraph contains mixed
            formatting, keep the original instead
            of risking a formatting change.
          */

          return result.changed
            ? result.xml
            : xml;
        }
      );

  /*
    Replace the document body paragraph content
    while preserving everything else in document.xml.

    We rebuild only the body paragraph sequence.
  */

  let outputXml =
    originalXml;

  let cursor = 0;

  outputXml =
    outputXml.replace(
      /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,
      () => {

        const replacement =
          rewrittenKept[
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


// =======================================================
// CREATE OUTPUT DOCX
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

  const outputBuffer =
    await zip.generateAsync({
      type:
        'nodebuffer',

      compression:
        'DEFLATE'
    });

  return outputBuffer;
}


// =======================================================
// SAVE OUTPUT
// =======================================================

async function saveOutput(
  storage,
  outputBuffer,
  job
) {

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

  const file =
    await storage.createFile({

      bucketId:
        RESUME_BUCKET_ID,

      fileId:
        ID.unique(),

      file:
        InputFile.fromBuffer(
          new Blob([
            outputBuffer
          ]),
          filename
        ),

      folder:
        'customized'
    });

  return {
    file,
    filename
  };
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

    const appwriteKey =
      process.env
        .JOB_AUTOMATION_API_KEY;

    const geminiKey =
      process.env
        .GEMINI_API_KEY;

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

    const client =
      new Client()
        .setEndpoint(
          process.env
            .APPWRITE_FUNCTION_API_ENDPOINT
        )
        .setProject(
          process.env
            .APPWRITE_FUNCTION_PROJECT_ID
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

    // ===================================================
    // SELECT JOB
    // ===================================================

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

    let job;

    if (
      input.jobId
    ) {

      const response =
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

      job = response;

    } else {

      job =
        await findTargetJob(
          tablesDB
        );
    }

    // ===================================================
    // MASTER CV
    // ===================================================

    const masterFile =
      await findMasterFile(
        storage
      );

    const masterBuffer =
      await downloadMasterCV(
        storage,
        masterFile.$id
      );

    // ===================================================
    // READ MASTER XML
    // ===================================================

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

    // ===================================================
    // GEMINI PLAN
    // ===================================================

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

    // ===================================================
    // CREATE CUSTOMIZED CV
    // ===================================================

    const outputBuffer =
      await createCustomizedCV(
        masterBuffer,
        plan
      );

    // ===================================================
    // SAVE
    // ===================================================

    const output =
      await saveOutput(
        storage,
        outputBuffer,
        job
      );

    // ===================================================
    // RESULT
    // ===================================================

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
          output.file.$id,

        fileName:
          output.filename,

        bucketId:
          RESUME_BUCKET_ID
      }

    });

  } catch (
    err
  ) {

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
