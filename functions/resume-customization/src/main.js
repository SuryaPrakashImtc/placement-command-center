import JSZip from 'jszip';
import {
  DOMParser,
  XMLSerializer
} from '@xmldom/xmldom';

import {
  Client,
  TablesDB,
  Query
} from 'node-appwrite';

// =======================================================
// CONFIGURATION
// =======================================================

const DATABASE_ID =
  '6aa03d1800119759c9bb';

const JOBS_TABLE_ID =
  'jobs';

const RESUME_BUCKET_ID =
  'resume-files';

const MASTER_CV_NAME =
  'MASTER CV FP(5).docx';

const GEMINI_MODEL =
  'gemini-3.8-flash';

/*
  IMPORTANT:

  The master CV is currently 2 pages.
  We do NOT change fonts, margins, spacing,
  section styling, etc.

  We only change/remove content.

  This is a conservative content-density gate.
  It prevents an output from being generated if
  the edited text is still too large.

  A later visual-QA step can perform a literal
  rendered page-count verification.
*/
const MAX_WORDS =
  480;

const TARGET_WORDS =
  450;

// =======================================================
// PROTECTED HEADINGS / CONTENT
// =======================================================

const PROTECTED_HEADINGS =
  new Set([
    'PROFESSIONAL SUMMARY',
    'EDUCATION',
    'INTERNSHIPS',
    'PROJECTS',
    'CERTIFICATIONS',
    'SKILLS',
    'ACHIEVEMENTS',
    'EXTRA-CURRICULAR ACTIVITY',
    'OTHER INFORMATION'
  ]);

// =======================================================
// HELPERS
// =======================================================

function normalize(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(value) {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function sanitizeFilePart(value) {
  return normalize(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
}

function isValidDate(value) {
  if (!value) {
    return false;
  }

  const date =
    new Date(value);

  return !Number.isNaN(
    date.getTime()
  );
}

// =======================================================
// DOCX XML HELPERS
// =======================================================

function paragraphText(
  paragraph
) {
  return normalize(
    [...paragraph.getElementsByTagName('w:t')]
      .map(node =>
        node.textContent || ''
      )
      .join('')
  );
}

function runFormattingSignature(
  run
) {
  const rPr =
    run.getElementsByTagName('w:rPr')[0];

  if (!rPr) {
    return '';
  }

  return new XMLSerializer()
    .serializeToString(rPr);
}

function isRewriteableParagraph(
  paragraph
) {
  // We never rewrite paragraphs containing
  // tabs because those usually contain
  // right-aligned dates.
  if (
    paragraph.getElementsByTagName(
      'w:tab'
    ).length > 0
  ) {
    return false;
  }

  // Don't touch explicit line breaks.
  if (
    paragraph.getElementsByTagName(
      'w:br'
    ).length > 0
  ) {
    return false;
  }

  // Don't touch hyperlinks / fields.
  if (
    paragraph.getElementsByTagName(
      'w:hyperlink'
    ).length > 0
  ) {
    return false;
  }

  if (
    paragraph.getElementsByTagName(
      'w:fldChar'
    ).length > 0 ||
    paragraph.getElementsByTagName(
      'w:instrText'
    ).length > 0
  ) {
    return false;
  }

  const runs =
    [...paragraph.getElementsByTagName('w:r')];

  const textNodes =
    [...paragraph.getElementsByTagName('w:t')];

  if (
    runs.length === 0 ||
    textNodes.length === 0
  ) {
    return false;
  }

  /*
    We only rewrite paragraphs when all runs
    use identical character formatting.

    This prevents us from destroying things
    such as bold emphasis inside a bullet.
  */
  const firstSignature =
    runFormattingSignature(
      runs[0]
    );

  return runs.every(
    run =>
      runFormattingSignature(run) ===
      firstSignature
  );
}

function paragraphIsHeading(
  text
) {
  return PROTECTED_HEADINGS.has(
    normalize(text)
  );
}

function getParagraphInfo(
  body
) {
  const paragraphs =
    [...body.getElementsByTagName('w:p')];

  return paragraphs.map(
    (paragraph, index) => {

      const text =
        paragraphText(
          paragraph
        );

      return {
        index,
        text,

        heading:
          paragraphIsHeading(
            text
          ),

        protected:
          index <= 3 ||
          paragraphIsHeading(
            text
          ),

        rewriteable:
          isRewriteableParagraph(
            paragraph
          )
      };
    }
  );
}

function extractVisibleText(
  body
) {
  return normalize(
    [...body.getElementsByTagName('w:t')]
      .map(
        node =>
          node.textContent || ''
      )
      .join(' ')
  );
}

function rewriteParagraph(
  paragraph,
  newText
) {
  const textNodes =
    [...paragraph.getElementsByTagName('w:t')];

  if (
    textNodes.length === 0
  ) {
    return;
  }

  textNodes[0].textContent =
    normalize(newText);

  for (
    let i = 1;
    i < textNodes.length;
    i++
  ) {
    textNodes[i].textContent =
      '';
  }
}

function getSectionRanges(
  paragraphInfos
) {
  const ranges = [];

  let current = null;

  for (
    const info
    of paragraphInfos
  ) {

    if (!info.heading) {
      continue;
    }

    if (current) {
      current.end =
        info.index - 1;
    }

    current = {
      heading:
        info.text,

      start:
        info.index + 1,

      end:
        paragraphInfos[
          paragraphInfos.length - 1
        ]?.index ??
        info.index
    };

    ranges.push(
      current
    );
  }

  return ranges;
}

function applyEditPlan(
  documentXml,
  plan
) {
  const parser =
    new DOMParser();

  const document =
    parser.parseFromString(
      documentXml,
      'application/xml'
    );

  const body =
    document.getElementsByTagName(
      'w:body'
    )[0];

  if (!body) {
    throw new Error(
      'Could not find Word document body.'
    );
  }

  const paragraphs =
    [...body.getElementsByTagName('w:p')];

  const infos =
    getParagraphInfo(
      body
    );

  const infoMap =
    new Map(
      infos.map(
        info => [
          info.index,
          info
        ]
      )
    );

  const deleteSet =
    new Set(
      Array.isArray(plan.delete)
        ? plan.delete.map(Number)
        : []
    );

  const replacements =
    Array.isArray(plan.replace)
      ? plan.replace
      : [];

  let replacementsApplied =
    0;

  let deletionsApplied =
    0;

  // -----------------------------------------------------
  // REPLACEMENTS
  // -----------------------------------------------------

  for (
    const replacement
    of replacements
  ) {

    const index =
      Number(
        replacement.paragraph
      );

    const info =
      infoMap.get(
        index
      );

    if (!info) {
      continue;
    }

    if (info.protected) {
      continue;
    }

    if (!info.rewriteable) {
      continue;
    }

    if (
      typeof replacement.newText !==
      'string'
    ) {
      continue;
    }

    if (
      /[\r\n]/.test(
        replacement.newText
      )
    ) {
      continue;
    }

    if (
      !normalize(
        replacement.newText
      )
    ) {
      continue;
    }

    rewriteParagraph(
      paragraphs[index],
      replacement.newText
    );

    replacementsApplied++;
  }

  // -----------------------------------------------------
  // PROTECT AT LEAST ONE CONTENT ITEM
  // PER SECTION
  // -----------------------------------------------------

  const sectionRanges =
    getSectionRanges(
      infos
    );

  for (
    const range
    of sectionRanges
  ) {

    const remaining =
      infos.filter(
        info =>
          info.index >=
            range.start &&
          info.index <=
            range.end &&
          info.text &&
          !info.protected &&
          !deleteSet.has(
            info.index
          )
      );

    if (
      remaining.length === 0
    ) {

      const candidate =
        infos.find(
          info =>
            info.index >=
              range.start &&
            info.index <=
              range.end &&
            info.text &&
            !info.protected
        );

      if (candidate) {
        deleteSet.delete(
          candidate.index
        );
      }
    }
  }

  // -----------------------------------------------------
  // DELETE PARAGRAPHS
  // -----------------------------------------------------

  for (
    const index
    of [...deleteSet].sort(
      (a, b) =>
        b - a
    )
  ) {

    const info =
      infoMap.get(
        index
      );

    if (!info) {
      continue;
    }

    // Never delete header/contact lines
    // or section headings.
    if (info.protected) {
      continue;
    }

    const paragraph =
      paragraphs[index];

    if (
      paragraph?.parentNode
    ) {

      paragraph.parentNode
        .removeChild(
          paragraph
        );

      deletionsApplied++;
    }
  }

  return {
    document,
    replacementsApplied,
    deletionsApplied
  };
}

// =======================================================
// APPWRITE STORAGE REST HELPERS
// =======================================================

async function appwriteRequest(
  url,
  projectId,
  apiKey,
  options = {}
) {

  const response =
    await fetch(
      url,
      {
        ...options,

        headers: {
          'X-Appwrite-Project':
            projectId,

          'X-Appwrite-Key':
            apiKey,

          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Appwrite ${response.status}: ${text.slice(0, 500)}`
    );
  }

  return text
    ? JSON.parse(text)
    : null;
}

// =======================================================
// FIND MASTER CV
// =======================================================

async function findMasterCv(
  endpoint,
  projectId,
  apiKey
) {

  const url =
    new URL(
      `${endpoint}/storage/buckets/${RESUME_BUCKET_ID}/files`
    );

  url.searchParams.set(
    'search',
    MASTER_CV_NAME
  );

  url.searchParams.append(
    'queries[]',
    'limit(100)'
  );

  const data =
    await appwriteRequest(
      url,
      projectId,
      apiKey
    );

  const file =
    (data.files || [])
      .find(
        item =>
          item.name ===
          MASTER_CV_NAME
      );

  if (!file) {
    throw new Error(
      `Master CV '${MASTER_CV_NAME}' was not found in the Resume Files bucket.`
    );
  }

  return file;
}

// =======================================================
// DOWNLOAD MASTER CV
// =======================================================

async function downloadMasterCv(
  endpoint,
  projectId,
  apiKey,
  fileId
) {

  const url =
    `${endpoint}/storage/buckets/` +
    `${RESUME_BUCKET_ID}/files/` +
    `${encodeURIComponent(fileId)}/download`;

  const response =
    await fetch(
      url,
      {
        headers: {
          'X-Appwrite-Project':
            projectId,

          'X-Appwrite-Key':
            apiKey
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Master CV download failed with HTTP ${response.status}.`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

// =======================================================
// UPLOAD CUSTOMIZED CV
// =======================================================

async function uploadCustomizedCv(
  endpoint,
  projectId,
  apiKey,
  fileId,
  fileName,
  buffer
) {

  const form =
    new FormData();

  form.append(
    'fileId',
    fileId
  );

  form.append(
    'folder',
    'customized'
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
            apiKey
        },

        body:
          form
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Customized CV upload failed: ${response.status} ${text.slice(0, 500)}`
    );
  }

  return JSON.parse(
    text
  );
}

// =======================================================
// FETCH JOBS
// =======================================================

async function fetchJobs(
  tablesDB
) {

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

  return response.rows || [];
}

// =======================================================
// CHOOSE JOB
// =======================================================

function chooseJob(
  jobs,
  requestedJobId
) {

  if (
    requestedJobId
  ) {

    const requested =
      jobs.find(
        job =>
          job.$id ===
          requestedJobId
      );

    if (!requested) {
      throw new Error(
        `Requested job '${requestedJobId}' was not found.`
      );
    }

    return requested;
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
    candidates.length === 0
  ) {
    throw new Error(
      'No suitable job is available for resume customization.'
    );
  }

  return candidates[0];
}

// =======================================================
// GEMINI EDIT PLAN
// =======================================================

async function generateGeminiPlan(
  geminiKey,
  job,
  paragraphInfos,
  currentWordCount,
  mode = 'initial'
) {

  const paragraphs =
    paragraphInfos
      .filter(
        info =>
          info.text
      )
      .map(
        info =>
          `[${info.index}] ${info.text}`
      )
      .join('\n');

  const prompt = `
You are the Resume Customization Agent for a job applicant.

You are editing an EXISTING MASTER CV.

THE MASTER CV IS THE ONLY SOURCE OF TRUTH.

JOB:
Company: ${job.company_name}
Title: ${job.job_title}
Location: ${job.location || 'Not specified'}

JOB DESCRIPTION:
${String(
  job.job_description || ''
).slice(0, 18000)}

MASTER CV PARAGRAPHS:
${paragraphs}

CURRENT WORD COUNT:
${currentWordCount}

TARGET WORD COUNT:
${TARGET_WORDS}

ABSOLUTE WORD LIMIT:
${MAX_WORDS}

HARD RULES:

1. Final output must be ONE PAGE.
2. Change CONTENT ONLY.
3. NEVER change fonts.
4. NEVER change font sizes.
5. NEVER change colors.
6. NEVER change margins.
7. NEVER change spacing.
8. NEVER change paragraph styles.
9. NEVER change section headings.
10. NEVER change the header/contact lines.
11. NEVER change dates.
12. NEVER invent facts.
13. NEVER invent responsibilities.
14. NEVER invent metrics.
15. NEVER invent employers.
16. NEVER invent skills.
17. NEVER invent achievements.
18. NEVER add a new section.
19. NEVER add a paragraph that does not already exist.
20. A replacement must use only facts already present in the master CV.
21. Prefer removing lower-relevance content over distorting strong evidence.
22. Keep the strongest evidence for this particular job.
23. Preserve the overall section structure.
24. You may remove old/less relevant education entries if necessary.
25. You may remove less relevant projects, certifications, achievements, extracurricular items, or other content.
26. Never remove every content item under a section.
27. Do not rewrite paragraphs containing dates/tabs or special formatting.
28. Rewrite only the paragraph numbers that are suitable plain-content paragraphs.
29. Maximum 4 rewritten paragraphs.
30. Maximum 14 deleted paragraphs.
31. Keep the result concise enough to fit one page.
32. Do not make generic keyword stuffing.

${mode === 'trim'
  ? `
SECOND-PASS TRIM:
The current draft is still above the safe one-page content budget.
Prioritize deleting the least relevant content and shortening existing
plain-content paragraphs. Do not touch protected formatting.
`
  : ''}

RETURN ONLY VALID JSON:

{
  "replace": [
    {
      "paragraph": 5,
      "newText": "..."
    }
  ],
  "delete": [
    17,
    18
  ],
  "rationale": "..."
}
`;

  const response =
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method:
          'POST',

        headers: {
          'x-goog-api-key':
            geminiKey,

          'Content-Type':
            'application/json'
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

              responseMimeType:
                'application/json',

              temperature:
                0.2
            }
          })
      }
    );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Gemini ${response.status}: ${responseText.slice(0, 500)}`
    );
  }

  const data =
    JSON.parse(
      responseText
    );

  const raw =
    data
      ?.candidates
      ?.[0]
      ?.content
      ?.parts
      ?.[0]
      ?.text;

  if (!raw) {
    throw new Error(
      'Gemini returned no resume edit plan.'
    );
  }

  let parsed;

  try {
    parsed =
      JSON.parse(
        raw
      );
  } catch {
    throw new Error(
      'Gemini returned invalid JSON.'
    );
  }

  if (
    !Array.isArray(
      parsed.replace
    ) ||
    !Array.isArray(
      parsed.delete
    )
  ) {
    throw new Error(
      'Gemini returned an invalid edit-plan structure.'
    );
  }

  return parsed;
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

    const endpoint =
      process.env
        .APPWRITE_FUNCTION_API_ENDPOINT;

    const projectId =
      process.env
        .APPWRITE_FUNCTION_PROJECT_ID;

    const appwriteKey =
      process.env
        .JOB_AUTOMATION_API_KEY;

    const geminiKey =
      process.env
        .GEMINI_API_KEY;

    // ---------------------------------------------------
    // CREDENTIAL CHECK
    // ---------------------------------------------------

    if (
      !endpoint ||
      !projectId ||
      !appwriteKey
    ) {

      throw new Error(
        'Appwrite environment variables are missing.'
      );
    }

    if (!geminiKey) {

      throw new Error(
        'GEMINI_API_KEY is missing.'
      );
    }

    // ---------------------------------------------------
    // READ OPTIONAL JOB ID
    // ---------------------------------------------------

    let requestedJobId =
      null;

    try {

      if (
        req?.query?.jobId
      ) {

        requestedJobId =
          req.query.jobId;

      } else if (
        req?.body
      ) {

        const body =
          typeof req.body ===
          'string'
            ? JSON.parse(
                req.body
              )
            : req.body;

        requestedJobId =
          body?.jobId ||
          null;
      }

    } catch {
      requestedJobId =
        null;
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
    // LOAD JOB
    // ---------------------------------------------------

    const jobs =
      await fetchJobs(
        tablesDB
      );

    const job =
      chooseJob(
        jobs,
        requestedJobId
      );

    log(
      `Selected job: ${job.company_name} | ${job.job_title} | ${job.$id}`
    );

    // ---------------------------------------------------
    // LOAD MASTER CV
    // ---------------------------------------------------

    const masterFile =
      await findMasterCv(
        endpoint,
        projectId,
        appwriteKey
      );

    log(
      `Master CV found: ${masterFile.$id}`
    );

    const masterBuffer =
      await downloadMasterCv(
        endpoint,
        projectId,
        appwriteKey,
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
        'The master CV does not contain word/document.xml.'
      );
    }

    const originalXml =
      await documentFile.async(
        'string'
      );

    const parser =
      new DOMParser();

    const originalDocument =
      parser.parseFromString(
        originalXml,
        'application/xml'
      );

    const originalBody =
      originalDocument
        .getElementsByTagName(
          'w:body'
        )[0];

    if (!originalBody) {

      throw new Error(
        'Master CV body could not be read.'
      );
    }

    const originalInfos =
      getParagraphInfo(
        originalBody
      );

    const originalWordCount =
      wordCount(
        extractVisibleText(
          originalBody
        )
      );

    log(
      `Master CV word count: ${originalWordCount}`
    );

    // ---------------------------------------------------
    // ASK GEMINI FOR EDIT PLAN
    // ---------------------------------------------------

    let currentXml =
      originalXml;

    let currentWordCount =
      originalWordCount;

    let finalPlan =
      null;

    // First pass.
    finalPlan =
      await generateGeminiPlan(
        geminiKey,
        job,
        originalInfos,
        currentWordCount,
        'initial'
      );

    let applied =
      applyEditPlan(
        currentXml,
        finalPlan
      );

    let editedDocument =
      applied.document;

    currentWordCount =
      wordCount(
        extractVisibleText(
          editedDocument
            .getElementsByTagName(
              'w:body'
            )[0]
        )
      );

    log(
      `After first edit pass: ${currentWordCount} words`
    );

    // ---------------------------------------------------
    // SECOND PASS IF TOO LONG
    // ---------------------------------------------------

    if (
      currentWordCount >
      MAX_WORDS
    ) {

      const currentBody =
        editedDocument
          .getElementsByTagName(
            'w:body'
          )[0];

      const currentInfos =
        getParagraphInfo(
          currentBody
        );

      const trimPlan =
        await generateGeminiPlan(
          geminiKey,
          job,
          currentInfos,
          currentWordCount,
          'trim'
        );

      const trimmed =
        applyEditPlan(
          new XMLSerializer()
            .serializeToString(
              editedDocument
            ),
          trimPlan
        );

      editedDocument =
        trimmed.document;

      currentWordCount =
        wordCount(
          extractVisibleText(
            editedDocument
              .getElementsByTagName(
                'w:body'
              )[0]
          )
        );

      log(
        `After second edit pass: ${currentWordCount} words`
      );

      finalPlan = {
        replace: [
          ...(finalPlan?.replace || []),
          ...(trimPlan?.replace || [])
        ],

        delete: [
          ...(finalPlan?.delete || []),
          ...(trimPlan?.delete || [])
        ],

        rationale:
          `${finalPlan?.rationale || ''} ${trimPlan?.rationale || ''}`
      };
    }

    // ---------------------------------------------------
    // HARD CONTENT GATE
    // ---------------------------------------------------

    if (
      currentWordCount >
      MAX_WORDS
    ) {

      throw new Error(
        `ONE_PAGE_GATE_FAILED: customized content is ${currentWordCount} words, above the ${MAX_WORDS}-word safety limit. No file was uploaded.`
      );
    }

    // ---------------------------------------------------
    // REMOVE STALE PAGINATION CACHE
    // ---------------------------------------------------

    const cachedBreaks =
      [
        ...editedDocument
          .getElementsByTagName(
            'w:lastRenderedPageBreak'
          )
      ];

    for (
      const node
      of cachedBreaks
    ) {

      node.parentNode
        ?.removeChild(
          node
        );
    }

    // ---------------------------------------------------
    // SERIALIZE FINAL DOCX
    // ---------------------------------------------------

    const finalXml =
      new XMLSerializer()
        .serializeToString(
          editedDocument
        );

    zip.file(
      'word/document.xml',
      finalXml
    );

    const finalBuffer =
      await zip.generateAsync({
        type:
          'nodebuffer',

        compression:
          'DEFLATE'
      });

    // ---------------------------------------------------
    // OUTPUT FILE
    // ---------------------------------------------------

    const outputFileName =
      `Customized_${sanitizeFilePart(job.company_name)}_${sanitizeFilePart(job.job_title)}.docx`;

    const outputFileId =
      crypto
        .randomUUID()
        .replaceAll(
          '-',
          ''
        )
        .slice(
          0,
          32
        );

    const uploaded =
      await uploadCustomizedCv(
        endpoint,
        projectId,
        appwriteKey,
        outputFileId,
        outputFileName,
        finalBuffer
      );

    // ---------------------------------------------------
    // RESULT
    // ---------------------------------------------------

    const result = {

      status:
        'SUCCESS',

      job: {

        id:
          job.$id,

        company:
          job.company_name,

        title:
          job.job_title
      },

      masterFile: {

        id:
          masterFile.$id,

        name:
          masterFile.name
      },

      customizedFile: {

        id:
          uploaded.$id,

        name:
          uploaded.name,

        bucket:
          RESUME_BUCKET_ID
      },

      customization: {

        originalWordCount:
          originalWordCount,

        finalWordCount:
          currentWordCount,

        targetWordCount:
          TARGET_WORDS,

        maximumWordCount:
          MAX_WORDS,

        replacementsApplied:
          applied.replacementsApplied,

        deletionsApplied:
          applied.deletionsApplied,

        contentOnly:
          true,

        formattingRedesign:
          false
      },

      gate: {

        contentSafetyGate:
          currentWordCount <= MAX_WORDS,

        renderedPageCount:
          'NOT_VERIFIED_IN_APPWRITE_RUNTIME',

        note:
          'The agent uses a conservative content-density gate. A literal Word page-count QA step should verify the final rendered file before automated submission.'
      }
    };

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
      err.message
    );

    return res.json(
      {
        status:
          'FAILED',

        error:
          err.message
      },
      500
    );
  }
};
