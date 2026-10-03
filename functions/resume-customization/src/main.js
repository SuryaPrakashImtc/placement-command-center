import {
  Client,
  TablesDB,
  Query,
  Storage,
  ID
} from 'node-appwrite';

import {
  InputFile
} from 'node-appwrite/file';

import JSZip from 'jszip';

// =======================================================
// FIXED APPWRITE CONFIGURATION
// =======================================================

const DATABASE_ID =
  '6aa03d1800119759c9bb';

const JOBS_TABLE_ID =
  'jobs';

// VERIFIED Resume Files bucket ID
const RESUME_BUCKET_ID =
  '6ac038600011e9e4bc37';

// LOCKED MASTER CV FILE NAME
const MASTER_FILE_NAME =
  'MASTER CV FP(5).docx';

// Current Gemini model
const GEMINI_MODEL =
  'gemini-3.5-flash';

// =======================================================
// HARD RESUME RULES
// =======================================================
//
// The master CV's format/layout is locked.
//
// The agent may ONLY:
// - rewrite content
// - shorten content
// - remove content
//
// The agent must NOT:
// - change font
// - change font size
// - change colors
// - change margins
// - change spacing
// - change section order
// - redesign the CV
//
// Final output must fit a conservative one-page
// content budget.
//
// The uploaded master CV is currently 2 pages;
// its first page demonstrates approximately 403 words.
// We therefore keep a lower safety budget.
// =======================================================

const MAX_ONE_PAGE_WORDS =
  365;

const MAX_ONE_PAGE_CHARS =
  3000;

// =======================================================
// MASTER CV PARAGRAPH MAP
// =======================================================
//
// These indexes belong to the locked master CV.
// Headings and contact information are protected.
// =======================================================

const PROTECTED_PARAGRAPHS =
  new Set([
    2, 3, 4, 6, 15,
    21, 32, 38, 44,
    48, 56
  ]);

const EDITABLE_PARAGRAPHS =
  new Set([
    5,

    7, 8, 9, 10,
    11, 12, 13, 14,

    16, 17, 18, 19, 20,

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
// FALLBACK ONE-PAGE REDUCTION ORDER
// =======================================================
//
// We remove lower-priority content first.
// Section headings themselves are NEVER removed.
//
// =======================================================

const REDUCTION_GROUPS = [

  // Lowest-value / optional
  [58],          // Hobbies

  // School education
  [11, 12],      // 12th
  [13, 14],      // 10th

  // Less essential skill grouping
  [42],          // Office Productivity

  // Lower-priority achievements
  [47],          // Jila Puraskar
  [45],          // Concord

  // Less essential certifications
  [35],          // Price Psychology
  [36],          // AI Tools Workshop
  [37],          // Deloitte simulation

  // Less essential extracurricular
  [53, 54],      // Scouts activity
  [51, 52],      // Cubmaster
  [49, 50],      // IIPC

  // Internship compression fallback
  [20],
  [19],
  [18],

  // Project compression fallback
  [29],
  [23],
  [25],
  [31],
  [27],

  // Last-resort full project removal
  [30, 31],
  [28, 29],
  [26, 27],
  [24, 25],
  [22, 23]
];

// =======================================================
// TEXT HELPERS
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
// DOCX PARAGRAPH EXTRACTION
// =======================================================

function extractParagraphs(
  xml
) {

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
        paragraphXml,

      isHeading:
        /<w:pStyle[^>]*w:val="Heading1"/.test(
          paragraphXml
        ),

      isList:
        /<w:numPr[\s\S]*?<w:numId[^>]*w:val="2"/.test(
          paragraphXml
        )
    });

    index++;
  }

  return paragraphs;
}

// =======================================================
// REPLACE PARAGRAPH CONTENT
// =======================================================
//
// IMPORTANT:
// We do NOT create new paragraphs.
// We do NOT change paragraph properties.
// We preserve the existing XML structure.
//
// Text is distributed across the existing text runs
// so the run formatting remains part of the template.
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

  const safeText =
    String(newText || '');

  const originalLengths =
    nodes.map(
      node =>
        node.text.length
    );

  const totalOriginal =
    originalLengths.reduce(
      (a, b) =>
        a + b,
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
      i ===
      nodes.length - 1
    ) {

      pieces.push(
        safeText.slice(
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
          safeText.length *
          proportion
        )
      );

    pieces.push(
      safeText.slice(
        consumed,
        consumed +
          targetLength
      )
    );

    consumed +=
      targetLength;
  }

  let output = '';

  let cursor = 0;

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

    const needsPreserve =
      /^\s|\s$/.test(
        piece
      );

    if (
      needsPreserve
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
      paragraphRegex.exec(
        xml
      )) !== null
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
// REPLACE SELECTED PARAGRAPHS
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
      paragraphRegex.exec(
        xml
      )) !== null
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

    const original =
      match[0];

    const hasReplacement =
      Object.prototype.hasOwnProperty.call(
        replacements,
        String(index)
      );

    if (
      hasReplacement &&
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
// APPLY GEMINI PLAN
// =======================================================

function applyPlan(
  xml,
  plan
) {

  let output =
    xml;

  const replacements = {};

  if (
    plan &&
    plan.replacements &&
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
        Number.isInteger(
          index
        ) &&
        EDITABLE_PARAGRAPHS.has(
          index
        ) &&
        !PROTECTED_PARAGRAPHS.has(
          index
        ) &&
        typeof value ===
          'string' &&
        normalizeText(
          value
        )
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
    replaceParagraphs(
      output,
      replacements
    );

  output =
    removeParagraphs(
      output,
      removals
    );

  return {
    xml: output,
    removals
  };
}

// =======================================================
// DOCUMENT METRICS
// =======================================================

function getMetrics(
  xml
) {

  const paragraphs =
    extractParagraphs(
      xml
    );

  const fullText =
    normalizeText(
      paragraphs
        .map(
          paragraph =>
            paragraph.text
        )
        .join(' ')
    );

  return {

    words:
      fullText
        ? fullText.split(/\s+/).length
        : 0,

    chars:
      fullText.length,

    paragraphs
  };
}

function exceedsBudget(
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
// ONE-PAGE REDUCTION
// =======================================================
//
// We ONLY delete content paragraphs.
// We NEVER touch formatting.
//
// =======================================================

function reduceToOnePage(
  xml,
  removedAlready
) {

  let output =
    xml;

  const removed =
    [
      ...removedAlready
    ];

  let metrics =
    getMetrics(
      output
    );

  if (
    !exceedsBudget(
      metrics
    )
  ) {

    return {
      xml: output,
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
      validGroup.length ===
      0
    ) {
      continue;
    }

    const existing =
      new Map(
        metrics.paragraphs.map(
          paragraph =>
            [
              paragraph.index,
              paragraph.text
            ]
        )
      );

    const hasContent =
      validGroup.some(
        index =>
          existing.has(index) &&
          existing.get(index)
      );

    if (!hasContent) {
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
      getMetrics(
        output
      );

    if (
      !exceedsBudget(
        metrics
      )
    ) {
      break;
    }
  }

  return {
    xml: output,
    removed,
    metrics
  };
}

// =======================================================
// APPWRITE STORAGE
// =======================================================

async function findMasterFile(
  storage
) {

  const result =
    await storage.listFiles({
      bucketId:
        RESUME_BUCKET_ID,

      limit:
        100,

      offset:
        0
    });

  const files =
    Array.isArray(
      result.files
    )
      ? result.files
      : [];

  const matches =
    files.filter(
      file =>
        file.name ===
        MASTER_FILE_NAME
    );

  if (
    matches.length ===
    0
  ) {

    throw new Error(
      `Master CV '${MASTER_FILE_NAME}' was not found in bucket ${RESUME_BUCKET_ID}.`
    );
  }

  matches.sort(
    (a, b) =>
      new Date(
        b.$updatedAt || 0
      ).getTime() -
      new Date(
        a.$updatedAt || 0
      ).getTime()
  );

  return matches[0];
}

async function downloadMasterFile(
  storage,
  fileId
) {

  const data =
    await storage.getFileDownload({
      bucketId:
        RESUME_BUCKET_ID,

      fileId
    });

  if (
    Buffer.isBuffer(data)
  ) {

    return data;
  }

  if (
    data instanceof Uint8Array
  ) {

    return Buffer.from(
      data
    );
  }

  if (
    data instanceof ArrayBuffer
  ) {

    return Buffer.from(
      data
    );
  }

  if (
    data &&
    typeof data.arrayBuffer ===
      'function'
  ) {

    return Buffer.from(
      await data.arrayBuffer()
    );
  }

  throw new Error(
    'Unable to convert master CV download into a Buffer.'
  );
}

async function uploadCustomizedFile(
  storage,
  buffer,
  fileName
) {

  return storage.createFile({

    bucketId:
      RESUME_BUCKET_ID,

    fileId:
      ID.unique(),

    file:
      InputFile.fromBuffer(
        buffer,
        fileName
      ),

    folder:
      'customized'
  });
}

// =======================================================
// JOB DATA
// =======================================================

async function fetchAllJobs(
  tablesDB
) {

  let jobs = [];

  let offset = 0;

  while (true) {

    const result =
      await tablesDB.listRows({

        databaseId:
          DATABASE_ID,

        tableId:
          JOBS_TABLE_ID,

        queries: [
          Query.limit(100),
          Query.offset(offset)
        ]
      });

    const rows =
      result.rows || [];

    jobs.push(
      ...rows
    );

    if (
      rows.length < 100
    ) {
      break;
    }

    offset +=
      rows.length;
  }

  return jobs;
}

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

  return null;
}

function chooseJob(
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
        `Job '${requestedJobId}' was not found.`
      );
    }

    return exact;
  }

  const usable =
    jobs.filter(
      job =>
        job.eligibility_status !==
          'NOT_ELIGIBLE' &&
        job.match_status !==
          'NOT_A_MATCH'
    );

  usable.sort(
    (a, b) =>
      (
        Number(
          b.opportunity_score
        ) || 0
      ) -
      (
        Number(
          a.opportunity_score
        ) || 0
      )
  );

  if (
    usable.length ===
    0
  ) {

    throw new Error(
      'No usable jobs are available for resume customization.'
    );
  }

  return usable[0];
}

// =======================================================
// GEMINI
// =======================================================

function buildGeminiPrompt(
  job,
  masterParagraphs
) {

  const masterText =
    masterParagraphs
      .filter(
        paragraph =>
          paragraph.text
      )
      .map(
        paragraph =>
          `[${paragraph.index}] ${paragraph.text}`
      )
      .join('\n');

  return `
You are the Resume Customization Agent for a job applicant.

Your job is to create a CONTENT-ONLY edit plan for the locked master CV.

MASTER CV RULES
- The master CV format is immutable.
- Do not redesign it.
- Do not change fonts.
- Do not change font sizes.
- Do not change colors.
- Do not change margins.
- Do not change spacing.
- Do not change section order.
- Do not create new sections.
- Do not change the candidate's name or contact details.
- Do not change education facts or dates.
- Do not invent facts.
- Do not invent metrics.
- Do not invent tools.
- Do not invent employers.
- Do not invent achievements.
- Use only facts explicitly contained in the master CV.
- You may rewrite existing paragraph content.
- You may remove existing content paragraphs.
- You may shorten content.
- You may select the most relevant existing projects, skills, certifications and achievements.
- The final CV must fit one page.
- Never solve the one-page requirement by shrinking formatting.
- Prefer approximately 330-360 words.

JOB
Title: ${job.job_title || ''}
Company: ${job.company_name || ''}
Location: ${job.location || ''}
Function: ${job.function || ''}
Department: ${job.department || ''}
Experience required: ${job.experience_required || ''}
Education required: ${job.education_required || ''}
Salary: ${job.salary_range || ''}

JOB DESCRIPTION
${String(
  job.job_description || ''
).slice(0, 14000)}

LOCKED MASTER CV PARAGRAPHS
${masterText}

IMPORTANT PARAGRAPH RULES
- Only use indexes that exist above.
- Never remove or rewrite protected headings/contact paragraphs.
- Prefer rewriting summary, internship bullets, relevant project bullets and skills.
- Remove lower-value content instead of making the CV longer.
- Preserve truthful quantitative evidence such as ₹6.5 Cr, ₹85,000, 100+, 8+, 23+, 50+, 200+, 20+, etc. only when relevant.
- Do not add a number that is not already in the CV.

RETURN ONLY VALID JSON:

{
  "replacements": {
    "5": "new summary",
    "17": "new internship bullet",
    "39": "new skills line"
  },
  "removeParagraphs": [11,12,58],
  "reason": "brief reason"
}
`;
}

function cleanGeminiJson(
  text
) {

  return String(text || '')
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

async function generatePlan(
  apiKey,
  job,
  masterParagraphs
) {

  const prompt =
    buildGeminiPrompt(
      job,
      masterParagraphs
    );

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const response =
    await fetch(
      endpoint,
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

    throw new Error(
      `Gemini ${response.status}: ${raw.slice(0, 500)}`
    );
  }

  const data =
    JSON.parse(
      raw
    );

  const text =
    data
      ?.candidates?.[0]
      ?.content?.parts?.[0]
      ?.text;

  if (!text) {

    throw new Error(
      'Gemini returned no resume edit plan.'
    );
  }

  return JSON.parse(
    cleanGeminiJson(
      text
    )
  );
}

// =======================================================
// OUTPUT NAME
// =======================================================

function safePart(
  value,
  fallback
) {

  const result =
    String(
      value || fallback
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
      );

  return (
    result ||
    fallback
  );
}

function createOutputName(
  job
) {

  return (
    `CV-${safePart(
      job.job_title,
      'Job'
    )}-` +
    `${safePart(
      job.company_name,
      'Company'
    )}-` +
    `${Date.now()}.docx`
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

    // ---------------------------------------------------
    // APPWRITE CLIENT
    // ---------------------------------------------------

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

    // ---------------------------------------------------
    // SELECT JOB
    // ---------------------------------------------------

    const jobs =
      await fetchAllJobs(
        tablesDB
      );

    const job =
      chooseJob(
        jobs,
        getRequestedJobId(
          req
        )
      );

    // ---------------------------------------------------
    // FIND MASTER CV
    // ---------------------------------------------------

    const masterFile =
      await findMasterFile(
        storage
      );

    // ---------------------------------------------------
    // DOWNLOAD MASTER CV
    // ---------------------------------------------------

    const masterBuffer =
      await downloadMasterFile(
        storage,
        masterFile.$id
      );

    // ---------------------------------------------------
    // OPEN DOCX
    // ---------------------------------------------------

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
        'Master CV is not a valid DOCX: word/document.xml is missing.'
      );
    }

    let documentXml =
      await documentFile.async(
        'string'
      );

    // ---------------------------------------------------
    // READ MASTER STRUCTURE
    // ---------------------------------------------------

    const masterMetrics =
      getMetrics(
        documentXml
      );

    // ---------------------------------------------------
    // GEMINI EDIT PLAN
    // ---------------------------------------------------

    let plan;

    let aiUsed =
      true;

    let aiError =
      '';

    try {

      plan =
        await generatePlan(
          geminiKey,
          job,
          masterMetrics.paragraphs
        );

    } catch (
      geminiError
    ) {

      aiUsed =
        false;

      aiError =
        geminiError.message;

      /*
        Safe fallback:
        use only existing master content
        and aggressively remove lower-value
        content until one-page budget is met.
      */

      plan = {

        replacements: {},

        removeParagraphs: [

          58,

          11,
          12,

          13,
          14,

          42,

          47,
          45,

          35,
          36,
          37,

          53,
          54,

          51,
          52,

          49,
          50
        ],

        reason:
          'Gemini unavailable; conservative one-page fallback applied.'
      };
    }

    // ---------------------------------------------------
    // APPLY CONTENT PLAN
    // ---------------------------------------------------

    const applied =
      applyPlan(
        documentXml,
        plan
      );

    documentXml =
      applied.xml;

    let removed =
      applied.removals;

    // ---------------------------------------------------
    // ENFORCE ONE-PAGE CONTENT BUDGET
    // ---------------------------------------------------

    const reduced =
      reduceToOnePage(
        documentXml,
        removed
      );

    documentXml =
      reduced.xml;

    removed =
      [
        ...new Set(
          reduced.removed
        )
      ];

    const finalMetrics =
      reduced.metrics;

    if (
      exceedsBudget(
        finalMetrics
      )
    ) {

      throw new Error(
        `ONE_PAGE_GATE_FAILED: ${finalMetrics.words} words / ${finalMetrics.chars} characters remain after permitted content reduction.`
      );
    }

    // ---------------------------------------------------
    // WRITE DOCUMENT
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
    // UPLOAD CUSTOMIZED CV
    // ---------------------------------------------------

    const outputFileName =
      createOutputName(
        job
      );

    const uploaded =
      await uploadCustomizedFile(
        storage,
        outputBuffer,
        outputFileName
      );

    // ---------------------------------------------------
    // FINAL RESPONSE
    // ---------------------------------------------------

    return res.json({

      status:
        aiUsed
          ? 'SUCCESS'
          : 'PARTIAL_SUCCESS',

      job: {

        id:
          job.$id,

        title:
          job.job_title,

        company:
          job.company_name,

        location:
          job.location,

        matchStatus:
          job.match_status,

        eligibilityStatus:
          job.eligibility_status,

        opportunityScore:
          Number(
            job.opportunity_score
          ) || 0
      },

      masterCv: {

        fileId:
          masterFile.$id,

        fileName:
          masterFile.name
      },

      customizedCv: {

        fileId:
          uploaded.$id,

        fileName:
          uploaded.name,

        bucketId:
          RESUME_BUCKET_ID,

        folder:
          'customized'
      },

      onePageGate: {

        passed:
          true,

        words:
          finalMetrics.words,

        characters:
          finalMetrics.chars,

        maxWords:
          MAX_ONE_PAGE_WORDS,

        maxCharacters:
          MAX_ONE_PAGE_CHARS
      },

      contentCustomization: {

        aiUsed,

        aiError,

        removedParagraphs:
          removed.sort(
            (a, b) =>
              a - b
          ),

        reason:
          plan.reason || ''
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
