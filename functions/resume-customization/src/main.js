import {
  Client,
  TablesDB,
  Storage,
  ID,
  Query
} from 'node-appwrite';

import JSZip from 'jszip';

// =======================================================
// CONFIGURATION
// =======================================================

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
// MASTER CV MAP
// =======================================================
//
// These paragraph positions are based on the actual
// uploaded master CV.
//
// We change CONTENT only.
// We never redesign the document.
//

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
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&apos;'
    );
}


function decodeXml(value) {

  return String(value || '')
    .replace(
      /&amp;/g,
      '&'
    )
    .replace(
      /&lt;/g,
      '<'
    )
    .replace(
      /&gt;/g,
      '>'
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&apos;/g,
      "'"
    )
    .replace(
      /&#39;/g,
      "'"
    )
    .replace(
      /&#x27;/g,
      "'"
    );
}


function extractParagraphs(xml) {

  return [
    ...xml.matchAll(
      /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
    )
  ].map(
    match => match[0]
  );
}


function paragraphText(
  paragraphXml
) {

  const texts = [
    ...paragraphXml.matchAll(
      /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
    )
  ].map(
    match =>
      decodeXml(
        match[1]
      )
  );

  return texts.join('');
}


function getRunProperties(
  runXml
) {

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

  if (
    runs.length === 0
  ) {

    return {
      xml:
        paragraphXml,

      changed:
        false
    };
  }

  /*
    Only modify paragraphs where all runs
    use the same formatting.

    This is safer because your master CV
    contains formatted text.
  */

  const styles =
    runs.map(
      run =>
        getRunProperties(
          run[0]
        )
    );

  const uniqueStyles =
    new Set(styles);

  if (
    uniqueStyles.size > 1
  ) {

    return {
      xml:
        paragraphXml,

      changed:
        false
    };
  }

  const runProperties =
    getRunProperties(
      runs[0][0]
    );

  const newRun =
    `<w:r>` +
    runProperties +
    `<w:t xml:space="preserve">` +
    escapeXml(newText) +
    `</w:t>` +
    `</w:r>`;

  const output =
    paragraphXml
      .replace(
        /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g,
        ''
      )
      .replace(
        /(<w:p\b[^>]*>)/,
        `$1${newRun}`
      );

  return {
    xml:
      output,

    changed:
      true
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
        RESUME_BUCKET_ID
    });

  const files =
    response.files || [];

  const master =
    files.find(
      file =>
        file.name ===
        MASTER_FILENAME
    );

  if (!master) {

    throw new Error(
      `Master CV "${MASTER_FILENAME}" was not found in bucket "${RESUME_BUCKET_ID}".`
    );
  }

  return master;
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

      fileId:
        fileId
    });

  return Buffer.from(
    data
  );
}


// =======================================================
// FIND BEST JOB
// =======================================================

async function findTargetJob(
  tablesDB,
  requestedJobId
) {

  /*
    If the Orchestrator or an external caller
    gives us a specific job ID, use that.
  */

  if (
    requestedJobId
  ) {

    return await tablesDB.getRow({
      databaseId:
        DATABASE_ID,

      tableId:
        JOBS_TABLE_ID,

      rowId:
        String(
          requestedJobId
        )
    });
  }

  /*
    IMPORTANT:
    We intentionally do NOT use Query.equal()
    here. This avoids the query syntax problem
    you encountered.

    We retrieve up to 100 rows and filter them
    inside JavaScript.
  */

  const response =
    await tablesDB.listRows({
      databaseId:
        DATABASE_ID,

      tableId:
        JOBS_TABLE_ID,

      queries: [
        Query.limit(100)
      ]
    });

  const rows =
    response.rows || [];

  const candidates =
    rows.filter(
      job => {

        const eligibility =
          String(
            job.eligibility_status ||
            ''
          ).toUpperCase();

        const match =
          String(
            job.match_status ||
            ''
          ).toUpperCase();

        return (
          eligibility === 'ELIGIBLE' &&
          match !== 'NOT_A_MATCH'
        );
      }
    );

  if (
    candidates.length === 0
  ) {

    /*
      Fallback: any row that isn't explicitly
      rejected by eligibility.
    */

    const fallback =
      rows.filter(
        job =>
          String(
            job.eligibility_status ||
            ''
          ).toUpperCase()
            !==
          'NOT_ELIGIBLE'
      );

    if (
      fallback.length === 0
    ) {

      throw new Error(
        'No suitable job was found for resume customization.'
      );
    }

    fallback.sort(
      (a, b) =>
        Number(
          b.opportunity_score || 0
        ) -
        Number(
          a.opportunity_score || 0
        )
    );

    return fallback[0];
  }

  /*
    Prefer:
    HIGH_MATCH
    then opportunity score
    then recent jobs
  */

  candidates.sort(
    (a, b) => {

      const aHigh =
        String(
          a.match_status ||
          ''
        ).toUpperCase()
          ===
        'HIGH_MATCH'
          ? 1
          : 0;

      const bHigh =
        String(
          b.match_status ||
          ''
        ).toUpperCase()
          ===
        'HIGH_MATCH'
          ? 1
          : 0;

      if (
        bHigh !== aHigh
      ) {
        return bHigh - aHigh;
      }

      return (
        Number(
          b.opportunity_score ||
          0
        ) -
        Number(
          a.opportunity_score ||
          0
        )
      );
    }
  );

  return candidates[0];
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
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({

            contents: [
              {
                role:
                  'user',

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

  if (
    !response.ok
  ) {

    throw new Error(
      `Gemini API ${response.status}: ${responseText.slice(0, 500)}`
    );
  }

  const data =
    JSON.parse(
      responseText
    );

  const text =
    data
      ?.candidates
      ?.[0]
      ?.content
      ?.parts
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
You are the Resume Customization Agent.

You are customizing a LOCKED master CV for one job.

THIS IS NOT A RESUME REDESIGN TASK.

NON-NEGOTIABLE RULES:

1. The master CV's visual format must remain unchanged.
2. Never change fonts.
3. Never change font sizes.
4. Never change colors.
5. Never change margins.
6. Never change spacing.
7. Never change section headings.
8. Never change section order.
9. Never add a new section.
10. Never invent facts.
11. Never invent experience.
12. Never invent skills.
13. Never invent numbers.
14. Never invent employers.
15. Never invent qualifications.
16. Use ONLY evidence contained in the master CV.
17. The final document MUST be one page.
18. Content may be removed.
19. Content may be rewritten when the rewrite remains truthful.
20. Prefer concise wording over adding information.

TARGET JOB

Title:
${job.job_title || ''}

Company:
${job.company_name || ''}

Location:
${job.location || ''}

Function:
${job.function || ''}

Department:
${job.department || ''}

Experience:
${job.experience_required || ''}

Education:
${job.education_required || ''}

Salary:
${job.salary_range || ''}

JOB DESCRIPTION:
${job.job_description || ''}

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

TASK:

A. Rewrite the Professional Summary so it is strongly relevant to this job.

Maximum 40 words.

B. Select EXACTLY 3 project IDs.

Choose the 3 projects with the strongest evidence for this role.

C. Select EXACTLY 4 certification IDs.

D. Select EXACTLY 2 achievement IDs.

E. Optionally rewrite selected project bullets.

A project rewrite must:

- use only facts already present
- preserve all numbers and factual claims
- be concise
- be no longer than 200 characters
- improve relevance to the target job
- never add a capability that is not already evidenced

DO NOT modify:

- education
- internship bullets
- skills
- section headings
- formatting

The one-page constraint MUST be solved through content selection and concise wording, NOT by changing the document's visual formatting.

Return ONLY the requested JSON structure.
`;
}


// =======================================================
// VALIDATE GEMINI PLAN
// =======================================================

function validatePlan(
  plan,
  paragraphTexts
) {

  let summary =
    String(
      plan?.summary ||
      ''
    )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  /*
    Hard summary limit.
  */

  const summaryWords =
    summary
      .split(/\s+/)
      .filter(Boolean);

  if (
    summaryWords.length > 40
  ) {

    summary =
      summaryWords
        .slice(0, 40)
        .join(' ');
  }

  /*
    Safe project selection.
  */

  let projectIds =
    Array.isArray(
      plan?.projectsToKeep
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

  if (
    projectIds.length < 3
  ) {

    projectIds = [
      24,
      26,
      30
    ];
  }

  projectIds =
    [...new Set(projectIds)]
      .slice(0, 3);

  /*
    Safe certification selection.
  */

  let certificationIds =
    Array.isArray(
      plan?.certificationsToKeep
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

  if (
    certificationIds.length < 4
  ) {

    certificationIds = [
      33,
      34,
      36,
      37
    ];
  }

  certificationIds =
    [...new Set(
      certificationIds
    )].slice(0, 4);

  /*
    Safe achievement selection.
  */

  let achievementIds =
    Array.isArray(
      plan?.achievementsToKeep
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

  if (
    achievementIds.length < 2
  ) {

    achievementIds = [
      45,
      46
    ];
  }

  achievementIds =
    [...new Set(
      achievementIds
    )].slice(0, 2);

  /*
    Validate project rewrites.
  */

  const allowedProjectIds =
    new Set(
      projectIds
    );

  const projectRewrites =
    Array.isArray(
      plan?.projectRewrites
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

              const id =
                Number(
                  item.id
                );

              let text =
                String(
                  item.text ||
                  ''
                )
                  .replace(
                    /\s+/g,
                    ' '
                  )
                  .trim();

              /*
                Never allow an oversized rewrite.
              */

              if (
                text.length > 200
              ) {

                text = '';
              }

              /*
                Do not allow a rewrite to become
                dramatically longer than the original.
              */

              const project =
                PROJECTS[id];

              if (
                project &&
                paragraphTexts[
                  project.bullet
                ]
              ) {

                const originalLength =
                  paragraphTexts[
                    project.bullet
                  ].length;

                if (
                  text.length >
                  originalLength + 20
                ) {

                  text = '';
                }
              }

              return {
                id,
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
      projectIds,

    certificationsToKeep:
      certificationIds,

    achievementsToKeep:
      achievementIds,

    projectRewrites
  };
}


// =======================================================
// CREATE CUSTOMIZED DOCUMENT
// =======================================================

async function createCustomizedCV(
  masterBuffer,
  plan
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

  const originalXml =
    await documentFile.async(
      'string'
    );

  const paragraphs =
    extractParagraphs(
      originalXml
    );

  /*
    =====================================================
    ONE-PAGE CONTENT BUDGET
    =====================================================

    These are content removals only.

    We do NOT alter margins, fonts, spacing,
    section order or layout.

    Based on the actual master CV:
    - remove 12th
    - remove 10th
    - remove Office Productivity
    - remove Extra-Curricular Activity
    - remove Other Information
    - keep 3 projects
    - keep 4 certifications
    - keep 2 achievements
  */

  const removeIndexes =
    new Set([

      // 12th + date
      11,
      12,

      // 10th + date
      13,
      14,

      // Office Productivity
      42,

      // Extra-Curricular Activity
      48,
      49,
      50,
      51,
      52,
      53,
      54,

      // Other Information
      56,
      57,
      58
    ]);

  /*
    Remove non-selected projects.
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
    Remove non-selected certifications.
  */

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

  /*
    Remove non-selected achievements.
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
    Build replacement map.
  */

  const replacementMap =
    new Map();

  /*
    Professional Summary.
  */

  if (
    plan.summary
  ) {

    replacementMap.set(
      5,
      plan.summary
    );
  }

  /*
    Project rewrites.
  */

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

    replacementMap.set(
      project.bullet,
      rewrite.text
    );
  }

  /*
    Build final paragraph list.

    We preserve paragraph XML and therefore
    preserve paragraph formatting/layout.
  */

  const finalParagraphs =
    paragraphs
      .map(
        (xml, index) => {

          if (
            removeIndexes.has(
              index
            )
          ) {
            return '';
          }

          if (
            replacementMap.has(
              index
            )
          ) {

            const result =
              replaceParagraphText(
                xml,
                replacementMap.get(
                  index
                )
              );

            return result.changed
              ? result.xml
              : xml;
          }

          return xml;
        }
      )
      .filter(
        Boolean
      );

  /*
    Replace ONLY the body paragraphs.

    Everything else in document.xml stays intact:
    fonts, styles, section settings, margins,
    numbering, headers, etc.
  */

  let paragraphCursor =
    0;

  const updatedXml =
    originalXml.replace(
      /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g,
      () => {

        const replacement =
          finalParagraphs[
            paragraphCursor
          ];

        paragraphCursor++;

        return (
          replacement !== undefined
            ? replacement
            : ''
        );
      }
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
// UPLOAD CUSTOMIZED CV
// =======================================================
//
// We intentionally do NOT use InputFile.
//
// This uses Appwrite's documented REST upload
// endpoint with multipart/form-data.
//

async function uploadCustomizedCV(
  outputBuffer,
  job,
  appwriteKey
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

  const fileId =
    ID.unique();

  const form =
    new FormData();

  form.append(
    'fileId',
    fileId
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

  const endpoint =
    String(
      process.env
        .APPWRITE_FUNCTION_API_ENDPOINT
    ).replace(
      /\/$/,
      ''
    );

  const projectId =
    process.env
      .APPWRITE_FUNCTION_PROJECT_ID;

  const response =
    await fetch(
      `${endpoint}/storage/buckets/${RESUME_BUCKET_ID}/files`,
      {
        method:
          'POST',

        headers: {

          'X-Appwrite-Project':
            projectId,

          'X-Appwrite-Key':
            appwriteKey,

          'X-Appwrite-Response-Format':
            '2.3.0'
        },

        body:
          form
      }
    );

  const responseText =
    await response.text();

  if (
    !response.ok
  ) {

    throw new Error(
      `Appwrite Storage upload ${response.status}: ${responseText.slice(0, 500)}`
    );
  }

  return {
    file:
      JSON.parse(
        responseText
      ),

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
    // READ REQUEST
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

    // ===================================================
    // JOB
    // ===================================================

    const job =
      await findTargetJob(
        tablesDB,
        input.jobId
      );

    log(
      `Customizing resume for ${job.job_title} at ${job.company_name}`
    );

    // ===================================================
    // MASTER
    // ===================================================

    const masterFile =
      await findMasterFile(
        storage
      );

    log(
      `Master CV found: ${masterFile.$id}`
    );

    const masterBuffer =
      await downloadMasterCV(
        storage,
        masterFile.$id
      );

    // ===================================================
    // READ MASTER
    // ===================================================

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
        'The master CV does not contain word/document.xml.'
      );
    }

    const xml =
      await documentFile.async(
        'string'
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
    // GEMINI
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
        rawPlan,
        paragraphTexts
      );

    log(
      `Gemini selected projects: ${plan.projectsToKeep.join(', ')}`
    );

    // ===================================================
    // CREATE OUTPUT
    // ===================================================

    const outputBuffer =
      await createCustomizedCV(
        masterBuffer,
        plan
      );

    log(
      `Customized CV generated: ${outputBuffer.length} bytes`
    );

    // ===================================================
    // UPLOAD
    // ===================================================

    const output =
      await uploadCustomizedCV(
        outputBuffer,
        job,
        appwriteKey
      );

    log(
      `Customized CV uploaded: ${output.filename}`
    );

    // ===================================================
    // RESULT
    // ===================================================

    const result = {

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

        formattingChanged:
          false,

        onePageContentBudget:
          true
      },

      output: {

        fileId:
          output.file.$id,

        fileName:
          output.filename,

        bucketId:
          RESUME_BUCKET_ID
      }
    };

    /*
      Also log the result so that an asynchronous
      Appwrite execution still gives us useful
      information in Logs.
    */

    log(
      JSON.stringify(
        result
      )
    );

    return res.json(
      result
    );

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
