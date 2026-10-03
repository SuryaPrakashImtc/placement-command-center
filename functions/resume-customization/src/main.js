import * as sdk from 'node-appwrite';
import JSZip from 'jszip';
import crypto from 'node:crypto';

const {
  Client,
  TablesDB,
  Query
} = sdk;

// =======================================================
// APPWRITE CONFIG
// =======================================================

const DATABASE_ID =
  '6aa03d1800119759c9bb';

const JOBS_TABLE_ID =
  'jobs';

const RESUME_BUCKET_ID =
  '6ac038600011e9e4bc37';

const MASTER_FILE_ID =
  '6ac038a5000b8a394104';

const MASTER_FILE_NAME =
  'MASTER CV FP.docx';

// =======================================================
// GEMINI CONFIG
// =======================================================

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash'
];

// =======================================================
// ONE-PAGE SAFETY LIMIT
// =======================================================
//
// IMPORTANT:
// We NEVER change formatting.
// We only rewrite/remove content.
//
// This is a conservative content gate.
// Appwrite itself is not a Word renderer, so this
// prevents excessive content but does not pretend to
// measure rendered Word pages pixel-perfectly.
//
// =======================================================

const MAX_ONE_PAGE_WORDS =
  480;

const MAX_ONE_PAGE_CHARS =
  3600;

// =======================================================
// LOCKED MASTER CV PARAGRAPHS
// =======================================================
//
// These paragraph numbers come from the master CV XML.
// They correspond to the fixed structure of the uploaded
// master document.
//
// =======================================================

const PROTECTED_PARAGRAPHS =
  new Set([
    2, 3,              // Name + contact
    4,                  // Summary heading
    6,                  // Education heading
    7, 8, 9, 10,       // PGDM + graduation
    15,                 // Internship heading
    16,                 // Internship title/date
    21,                 // Projects heading
    32,                 // Certifications heading
    38,                 // Skills heading
    44,                 // Achievements heading
    48,                 // Extra-curricular heading
    56                  // Other information heading
  ]);

const EDITABLE_PARAGRAPHS =
  new Set([
    5,

    11, 12,
    13, 14,

    17, 18, 19, 20,

    22, 23,
    24, 25,
    26, 27,
    28, 29,
    30, 31,

    33, 34, 35, 36, 37,

    39, 40, 41, 42, 43,

    45, 46, 47,

    49, 50,
    51, 52,
    53, 54,

    57, 58
  ]);

// =======================================================
// LAST-RESORT CONTENT REDUCTION ORDER
// =======================================================
//
// Used ONLY if Gemini's output is still too long.
// We remove content rather than altering formatting.
//
// =======================================================

const REDUCTION_GROUPS = [

  [58],            // Hobbies

  [13, 14],        // 10th
  [11, 12],        // 12th

  [42],             // Office productivity

  [45],             // Concord
  [47],             // Jila Puraskar

  [51, 52],         // Cubmaster
  [53, 54],         // Scouts
  [49, 50],         // IIPC

  [35],             // Price Psychology
  [36],             // AI Tools
  [37],             // Deloitte

  [29],             // Sunscreen project bullet
  [22, 23],         // Technician guide

  [24, 25],         // General Mills

  [31],             // Purchase behaviour bullet

  [19],             // Creative/video internship bullet
  [20],             // Hotels/vendor internship bullet
  [18],             // Brochure internship bullet

  [26, 27],         // Insignia project
  [28, 29],         // Sunscreen project
  [30, 31],         // Purchase behaviour project

  [17]              // Main Blue Star bullet — last resort
];

// =======================================================
// XML HELPERS
// =======================================================

function normalizeText(value) {

  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, hex) =>
        String.fromCharCode(
          parseInt(hex, 16)
        )
    )
    .replace(
      /&#([0-9]+);/g,
      (_, dec) =>
        String.fromCharCode(
          Number(dec)
        )
    );
}

// =======================================================
// PARAGRAPH EXTRACTION
// =======================================================

function extractParagraphs(xml) {

  const paragraphRegex =
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

  const paragraphs = [];

  let match;
  let index = 0;

  while (
    (match =
      paragraphRegex.exec(xml)) !== null
  ) {

    const paragraphXml =
      match[0];

    const textNodes = [];

    const textRegex =
      /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;

    let textMatch;

    while (
      (textMatch =
        textRegex.exec(
          paragraphXml
        )) !== null
    ) {

      textNodes.push(
        decodeXml(
          textMatch[2]
        )
      );
    }

    paragraphs.push({
      index,
      text:
        normalizeText(
          textNodes.join('')
        ),
      xml:
        paragraphXml
    });

    index++;
  }

  return paragraphs;
}

// =======================================================
// REPLACE TEXT WITHOUT CHANGING RUN STRUCTURE
// =======================================================

function replaceParagraphText(
  paragraphXml,
  newText
) {

  const textRegex =
    /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;

  const nodes = [];

  let match;

  while (
    (match =
      textRegex.exec(
        paragraphXml
      )) !== null
  ) {

    nodes.push({

      attrs:
        match[1] || '',

      text:
        decodeXml(
          match[2]
        ),

      start:
        match.index,

      end:
        textRegex.lastIndex
    });
  }

  if (
    nodes.length === 0
  ) {

    return paragraphXml;
  }

  const replacementText =
    normalizeText(
      newText
    );

  const originalLengths =
    nodes.map(
      node =>
        node.text.length
    );

  const totalOriginal =
    originalLengths.reduce(
      (a, b) => a + b,
      0
    ) || 1;

  const pieces = [];

  let consumed = 0;

  for (
    let i = 0;
    i < nodes.length;
    i++
  ) {

    if (
      i === nodes.length - 1
    ) {

      pieces.push(
        replacementText.slice(
          consumed
        )
      );

      continue;
    }

    const proportion =
      originalLengths[i] /
      totalOriginal;

    const targetLength =
      Math.max(
        0,
        Math.round(
          replacementText.length *
          proportion
        )
      );

    pieces.push(
      replacementText.slice(
        consumed,
        consumed +
          targetLength
      )
    );

    consumed +=
      targetLength;
  }

  let cursor = 0;
  let output = '';

  for (
    let i = 0;
    i < nodes.length;
    i++
  ) {

    const node =
      nodes[i];

    output +=
      paragraphXml.slice(
        cursor,
        node.start
      );

    let attrs =
      node.attrs;

    const piece =
      pieces[i];

    if (
      /^\s|\s$/.test(
        piece
      )
    ) {

      if (
        /\bxml:space="[^"]*"/.test(
          attrs
        )
      ) {

        attrs =
          attrs.replace(
            /\bxml:space="[^"]*"/g,
            'xml:space="preserve"'
          );

      } else {

        attrs +=
          ' xml:space="preserve"';
      }

    } else {

      attrs =
        attrs.replace(
          /\s*xml:space="preserve"/g,
          ''
        );
    }

    output +=
      `<w:t${attrs}>${escapeXml(
        piece
      )}</w:t>`;

    cursor =
      node.end;
  }

  output +=
    paragraphXml.slice(
      cursor
    );

  return output;
}

// =======================================================
// REPLACE PARAGRAPHS
// =======================================================

function replaceParagraphs(
  xml,
  replacements
) {

  const paragraphRegex =
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

  let output = '';
  let cursor = 0;
  let index = 0;
  let match;

  while (
    (match =
      paragraphRegex.exec(xml)) !== null
  ) {

    const start =
      match.index;

    const end =
      paragraphRegex.lastIndex;

    const original =
      match[0];

    output +=
      xml.slice(
        cursor,
        start
      );

    if (
      Object.prototype.hasOwnProperty.call(
        replacements,
        String(index)
      ) &&
      EDITABLE_PARAGRAPHS.has(
        index
      ) &&
      !PROTECTED_PARAGRAPHS.has(
        index
      )
    ) {

      output +=
        replaceParagraphText(
          original,
          replacements[
            String(index)
          ]
        );

    } else {

      output +=
        original;
    }

    cursor =
      end;

    index++;
  }

  output +=
    xml.slice(
      cursor
    );

  return output;
}

// =======================================================
// REMOVE PARAGRAPHS
// =======================================================

function removeParagraphs(
  xml,
  indexes
) {

  const removeSet =
    new Set(indexes);

  const paragraphRegex =
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

  let output = '';
  let cursor = 0;
  let index = 0;
  let match;

  while (
    (match =
      paragraphRegex.exec(xml)) !== null
  ) {

    const start =
      match.index;

    const end =
      paragraphRegex.lastIndex;

    output +=
      xml.slice(
        cursor,
        start
      );

    if (
      !removeSet.has(
        index
      )
    ) {

      output +=
        match[0];
    }

    cursor =
      end;

    index++;
  }

  output +=
    xml.slice(
      cursor
    );

  return output;
}

// =======================================================
// APPLY GEMINI PLAN
// =======================================================

function applyPlan(
  xml,
  plan
) {

  let output = xml;

  const replacements = {};

  if (
    plan?.replacements &&
    typeof plan.replacements ===
      'object'
  ) {

    for (
      const [
        key,
        value
      ]
      of Object.entries(
        plan.replacements
      )
    ) {

      const index =
        Number(key);

      if (
        Number.isInteger(index) &&
        EDITABLE_PARAGRAPHS.has(
          index
        ) &&
        !PROTECTED_PARAGRAPHS.has(
          index
        ) &&
        typeof value ===
          'string' &&
        normalizeText(value)
      ) {

        replacements[
          String(index)
        ] =
          normalizeText(
            value
          );
      }
    }
  }

  output =
    replaceParagraphs(
      output,
      replacements
    );

  const removals =
    Array.isArray(
      plan?.removeParagraphs
    )
      ? plan.removeParagraphs
          .map(Number)
          .filter(
            index =>
              Number.isInteger(
                index
              ) &&
              EDITABLE_PARAGRAPHS.has(
                index
              ) &&
              !PROTECTED_PARAGRAPHS.has(
                index
              )
          )
      : [];

  output =
    removeParagraphs(
      output,
      removals
    );

  return {
    xml: output,
    removed: removals
  };
}

// =======================================================
// DOCUMENT METRICS
// =======================================================

function documentMetrics(
  xml
) {

  const paragraphs =
    extractParagraphs(
      xml
    );

  const text =
    normalizeText(
      paragraphs
        .map(
          p => p.text
        )
        .join(' ')
    );

  return {

    paragraphs,

    words:
      text
        ? text.split(
            /\s+/
          ).length
        : 0,

    chars:
      text.length
  };
}

function exceedsOnePageBudget(
  metrics
) {

  return (
    metrics.words >
      MAX_ONE_PAGE_WORDS ||
    metrics.chars >
      MAX_ONE_PAGE_CHARS
  );
}

// =======================================================
// REDUCE CONTENT UNTIL IT PASSES SAFETY GATE
// =======================================================

function reduceToOnePage(
  xml,
  alreadyRemoved
) {

  let output =
    xml;

  const removed =
    [
      ...alreadyRemoved
    ];

  let metrics =
    documentMetrics(
      output
    );

  if (
    !exceedsOnePageBudget(
      metrics
    )
  ) {

    return {
      xml:
        output,

      removed,

      metrics
    };
  }

  for (
    const group
    of REDUCTION_GROUPS
  ) {

    const validGroup =
      group.filter(
        index =>
          EDITABLE_PARAGRAPHS.has(
            index
          ) &&
          !PROTECTED_PARAGRAPHS.has(
            index
          )
      );

    if (
      validGroup.length === 0
    ) {
      continue;
    }

    output =
      removeParagraphs(
        output,
        validGroup
      );

    removed.push(
      ...validGroup
    );

    metrics =
      documentMetrics(
        output
      );

    if (
      !exceedsOnePageBudget(
        metrics
      )
    ) {
      break;
    }
  }

  return {

    xml:
      output,

    removed:
      [
        ...new Set(
          removed
        )
      ],

    metrics
  };
}

// =======================================================
// JOB DATA
// =======================================================

async function fetchAllJobs(
  tablesDB
) {

  const jobs = [];

  let cursor =
    null;

  while (true) {

    const queries = [
      Query.limit(100)
    ];

    if (cursor) {

      queries.push(
        Query.cursorAfter(
          cursor
        )
      );
    }

    const response =
      await tablesDB.listRows({
        databaseId:
          DATABASE_ID,

        tableId:
          JOBS_TABLE_ID,

        queries
      });

    const rows =
      response.rows || [];

    jobs.push(
      ...rows
    );

    if (
      rows.length < 100
    ) {
      break;
    }

    cursor =
      rows[
        rows.length - 1
      ].$id;
  }

  return jobs;
}

// =======================================================
// SELECT JOB
// =======================================================

function selectJob(
  jobs,
  requestedJobId
) {

  if (
    requestedJobId
  ) {

    const exact =
      jobs.find(
        job =>
          job.$id ===
          requestedJobId
      );

    if (!exact) {

      throw new Error(
        `Job '${requestedJobId}' was not found in the Jobs table.`
      );
    }

    return exact;
  }

  const candidates =
    jobs.filter(
      job =>
        job.eligibility_status !==
          'NOT_ELIGIBLE' &&
        job.match_status !==
          'NOT_A_MATCH'
    );

  candidates.sort(
    (a, b) => {

      const opportunityDiff =
        (
          Number(
            b.opportunity_score
          ) || 0
        ) -
        (
          Number(
            a.opportunity_score
          ) || 0
        );

      if (
        opportunityDiff !==
        0
      ) {

        return opportunityDiff;
      }

      const rank = {
        HIGH_MATCH: 3,
        MEDIUM_MATCH: 2,
        LOW_MATCH: 1,
        UNKNOWN: 0
      };

      return (
        (
          rank[
            b.match_status
          ] || 0
        ) -
        (
          rank[
            a.match_status
          ] || 0
        )
      );
    }
  );

  if (
    candidates.length ===
    0
  ) {

    throw new Error(
      'No eligible/matchable jobs are available.'
    );
  }

  return candidates[0];
}

// =======================================================
// APPWRITE STORAGE DOWNLOAD
// =======================================================

async function downloadMasterCv({
  endpoint,
  projectId,
  apiKey
}) {

  const url =
    `${endpoint}` +
    `/storage/buckets/` +
    `${encodeURIComponent(
      RESUME_BUCKET_ID
    )}` +
    `/files/` +
    `${encodeURIComponent(
      MASTER_FILE_ID
    )}` +
    `/download`;

  const response =
    await fetch(
      url,
      {
        method:
          'GET',

        headers: {

          'X-Appwrite-Project':
            projectId,

          'X-Appwrite-Key':
            apiKey
        }
      }
    );

  if (
    !response.ok
  ) {

    const text =
      await response.text();

    throw new Error(
      `Master CV download failed ${response.status}: ${text.slice(0, 500)}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

// =======================================================
// APPWRITE STORAGE UPLOAD
// =======================================================

async function uploadCustomizedCv({
  endpoint,
  projectId,
  apiKey,
  buffer,
  fileName
}) {

  const url =
    `${endpoint}` +
    `/storage/buckets/` +
    `${encodeURIComponent(
      RESUME_BUCKET_ID
    )}` +
    `/files`;

  const newFileId =
    crypto.randomUUID();

  const form =
    new FormData();

  form.append(
    'fileId',
    newFileId
  );

  form.append(
    'file',
    new Blob(
      [buffer],
      {
        type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }
    ),
    fileName
  );

  form.append(
    'folder',
    'customized'
  );

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
            apiKey
        },

        body:
          form
      }
    );

  const text =
    await response.text();

  if (
    !response.ok
  ) {

    throw new Error(
      `Customized CV upload failed ${response.status}: ${text.slice(0, 500)}`
    );
  }

  return JSON.parse(
    text
  );
}

// =======================================================
// REQUEST JOB ID
// =======================================================

function getRequestedJobId(
  req
) {

  if (
    req?.query?.jobId
  ) {

    return String(
      req.query.jobId
    );
  }

  if (
    req?.bodyJson?.jobId
  ) {

    return String(
      req.bodyJson.jobId
    );
  }

  if (
    req?.body
  ) {

    try {

      const parsed =
        JSON.parse(
          req.body
        );

      if (
        parsed?.jobId
      ) {

        return String(
          parsed.jobId
        );
      }

    } catch {
      // Automatic job selection.
    }
  }

  return null;
}

// =======================================================
// MASTER CV PROFILE FOR GEMINI
// =======================================================

function buildMasterProfile(
  paragraphs
) {

  return paragraphs
    .filter(
      paragraph =>
        paragraph.text
    )
    .map(
      paragraph =>
        `[${paragraph.index}] ${paragraph.text}`
    )
    .join('\n');
}

// =======================================================
// GEMINI JSON CLEANUP
// =======================================================

function stripJsonFences(
  value
) {

  return String(
    value || ''
  )
    .replace(
      /^```json\s*/i,
      ''
    )
    .replace(
      /^```\s*/i,
      ''
    )
    .replace(
      /\s*```$/i,
      ''
    )
    .trim();
}

// =======================================================
// GEMINI
// =======================================================

async function generateCustomizationPlan(
  apiKey,
  job,
  paragraphs
) {

  const prompt = `
You are a STRICT resume customization engine.

You are editing a LOCKED MASTER CV.

YOUR ONLY JOB:
Create a content-edit plan for this specific job.

NON-NEGOTIABLE RULES:

1. Use ONLY facts that already exist in the master CV.
2. Never invent experience, qualifications, employers, dates, numbers, tools, responsibilities, achievements, certifications or skills.
3. Do not modify the candidate name or contact information.
4. Do not modify section headings.
5. Do not modify education facts or dates.
6. Do not change fonts.
7. Do not change font sizes.
8. Do not change colors.
9. Do not change margins.
10. Do not change spacing.
11. Do not change bullets.
12. Do not change section order.
13. Do not add sections.
14. You may ONLY:
    a) rewrite existing editable paragraph content, and/or
    b) remove existing editable paragraphs.
15. The final CV must fit on ONE PAGE.
16. The master CV is currently a two-page document. Reduce content rather than changing formatting.
17. Keep the strongest quantified achievements whenever they are relevant.
18. Prefer concise wording.
19. Do not rewrite a paragraph merely for style. Rewrite only when it improves job relevance.
20. Never create facts that are merely implied.

JOB:

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
${String(
  job.job_description || ''
).slice(0, 16000)}

MASTER CV PARAGRAPHS:

${buildMasterProfile(
  paragraphs
)}

EDITABLE PARAGRAPH INDEXES:
${[...EDITABLE_PARAGRAPHS].join(', ')}

PROTECTED PARAGRAPH INDEXES:
${[...PROTECTED_PARAGRAPHS].join(', ')}

OUTPUT ONLY VALID JSON.

Use exactly:

{
  "replacements": {
    "paragraphIndex": "new truthful concise paragraph text"
  },
  "removeParagraphs": [paragraphIndex],
  "reason": "one short sentence"
}

Do not output markdown.
Do not output commentary outside the JSON.
`;

  let lastError =
    null;

  for (
    const model
    of GEMINI_MODELS
  ) {

    try {

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const response =
        await fetch(
          url,
          {
            method:
              'POST',

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
                    5000,

                  responseMimeType:
                    'application/json'
                }
              })
          }
        );

      const raw =
        await response.text();

      if (
        !response.ok
      ) {

        lastError =
          new Error(
            `Gemini ${model} ${response.status}: ${raw.slice(0, 500)}`
          );

        continue;
      }

      const data =
        JSON.parse(
          raw
        );

      const responseText =
        data
          ?.candidates?.[0]
          ?.content?.parts?.[0]
          ?.text;

      if (
        !responseText
      ) {

        lastError =
          new Error(
            `Gemini ${model} returned no response text.`
          );

        continue;
      }

      return {

        model,

        plan:
          JSON.parse(
            stripJsonFences(
              responseText
            )
          )
      };

    } catch (
      geminiError
    ) {

      lastError =
        geminiError;
    }
  }

  throw (
    lastError ||
    new Error(
      'Gemini customization failed.'
    )
  );
}

// =======================================================
// OUTPUT FILE NAME
// =======================================================

function createOutputFileName(
  job
) {

  const clean =
    value =>
      String(
        value || ''
      )
        .replace(
          /[^a-z0-9]+/gi,
          '-'
        )
        .replace(
          /^-+|-+$/g,
          ''
        )
        .slice(
          0,
          50
        ) ||
      'Job';

  return (
    `CV-${clean(
      job.job_title
    )}-${clean(
      job.company_name
    )}-${Date.now()}.docx`
  );
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

    if (
      !appwriteKey
    ) {

      throw new Error(
        'JOB_AUTOMATION_API_KEY is missing.'
      );
    }

    if (
      !geminiKey
    ) {

      throw new Error(
        'GEMINI_API_KEY is missing.'
      );
    }

    if (
      !endpoint ||
      !projectId
    ) {

      throw new Error(
        'Required Appwrite function variables are missing.'
      );
    }

    // ---------------------------------------------------
    // APPWRITE CLIENT
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

    // ---------------------------------------------------
    // SELECT JOB
    // ---------------------------------------------------

    const jobs =
      await fetchAllJobs(
        tablesDB
      );

    const job =
      selectJob(
        jobs,
        getRequestedJobId(
          req
        )
      );

    // ---------------------------------------------------
    // DOWNLOAD MASTER CV
    // ---------------------------------------------------

    const masterBuffer =
      await downloadMasterCv({

        endpoint,

        projectId,

        apiKey:
          appwriteKey
      });

    // ---------------------------------------------------
    // LOAD DOCX
    // ---------------------------------------------------

    const zip =
      await JSZip.loadAsync(
        masterBuffer
      );

    const documentFile =
      zip.file(
        'word/document.xml'
      );

    if (
      !documentFile
    ) {

      throw new Error(
        'Master CV is not a valid DOCX: word/document.xml is missing.'
      );
    }

    let documentXml =
      await documentFile.async(
        'string'
      );

    const masterMetrics =
      documentMetrics(
        documentXml
      );

    // ---------------------------------------------------
    // GEMINI
    // ---------------------------------------------------

    const geminiResult =
      await generateCustomizationPlan(
        geminiKey,
        job,
        masterMetrics.paragraphs
      );

    const plan =
      geminiResult.plan ||
      {};

    // ---------------------------------------------------
    // APPLY AI CONTENT CHANGES
    // ---------------------------------------------------

    const applied =
      applyPlan(
        documentXml,
        plan
      );

    documentXml =
      applied.xml;

    // ---------------------------------------------------
    // ONE-PAGE CONTENT SAFETY
    // ---------------------------------------------------

    const requestedRemoved =
      Array.isArray(
        plan.removeParagraphs
      )
        ? plan.removeParagraphs
            .map(Number)
            .filter(
              index =>
                Number.isInteger(index) &&
                EDITABLE_PARAGRAPHS.has(
                  index
                ) &&
                !PROTECTED_PARAGRAPHS.has(
                  index
                )
            )
        : [];

    const reduction =
      reduceToOnePage(
        documentXml,
        [
          ...new Set(
            [
              ...requestedRemoved
            ]
          )
        ]
      );

    documentXml =
      reduction.xml;

    const finalMetrics =
      reduction.metrics;

    // ---------------------------------------------------
    // HARD STOP IF STILL TOO LONG
    // ---------------------------------------------------

    if (
      exceedsOnePageBudget(
        finalMetrics
      )
    ) {

      throw new Error(
        `One-page safety gate failed. Final content: ${finalMetrics.words} words / ${finalMetrics.chars} characters. No formatting was changed.`
      );
    }

    // ---------------------------------------------------
    // WRITE BACK DOCUMENT XML
    // ---------------------------------------------------

    zip.file(
      'word/document.xml',
      documentXml
    );

    const outputBuffer =
      await zip.generateAsync({

        type:
          'nodebuffer',

        compression:
          'DEFLATE',

        compressionOptions: {
          level:
            6
        }
      });

    // ---------------------------------------------------
    // UPLOAD
    // ---------------------------------------------------

    const outputFileName =
      createOutputFileName(
        job
      );

    const uploaded =
      await uploadCustomizedCv({

        endpoint,

        projectId,

        apiKey:
          appwriteKey,

        buffer:
          outputBuffer,

        fileName:
          outputFileName
      });

    // ---------------------------------------------------
    // SUCCESS
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

        opportunityScore:
          Number(
            job.opportunity_score
          ) || 0,

        matchStatus:
          job.match_status,

        eligibilityStatus:
          job.eligibility_status
      },

      masterCv: {

        bucketId:
          RESUME_BUCKET_ID,

        fileId:
          MASTER_FILE_ID,

        fileName:
          MASTER_FILE_NAME
      },

      customizedCv: {

        bucketId:
          RESUME_BUCKET_ID,

        fileId:
          uploaded.$id,

        fileName:
          uploaded.name,

        folder:
          'customized'
      },

      customization: {

        geminiModel:
          geminiResult.model,

        reason:
          plan.reason || '',

        removedParagraphs:
          reduction.removed.sort(
            (a, b) =>
              a - b
          ),

        finalWords:
          finalMetrics.words,

        finalCharacters:
          finalMetrics.chars,

        maxWords:
          MAX_ONE_PAGE_WORDS,

        maxCharacters:
          MAX_ONE_PAGE_CHARS
      },

      rules: {

        formattingChanged:
          false,

        structureChanged:
          false,

        onePageSafetyGate:
          true,

        masterTemplatePreserved:
          true
      }
    });

  } catch (
    err
  ) {

    error(
      err.message
    );

    return res.json({

      status:
        'FAILED',

      error:
        err.message
    }, 500);
  }
};
