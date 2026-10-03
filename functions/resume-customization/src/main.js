import {
  Client,
  TablesDB,
  Query,
  ID
} from 'node-appwrite';

import JSZip from 'jszip';

// =======================================================
// FIXED CONFIGURATION
// =======================================================

const DATABASE_ID = '6aa03d1800119759c9bb';
const JOBS_TABLE_ID = 'jobs';

// REAL Appwrite Storage bucket ID supplied by user.
const RESUME_BUCKET_ID = '6ac038600011e9e4bc37';

// Exact master CV filename uploaded by user.
const MASTER_CV_FILENAME = 'MASTER CV FP(5).docx';

// Conservative one-page content budget.
// The original master CV has ~3,077 visible characters
// before its cached second-page break.
// We stay materially below that.
const MAX_ONE_PAGE_CHARS = 2600;

// Gemini model.
const GEMINI_MODEL = 'gemini-3.8-flash';

// =======================================================
// CANDIDATE TRUTH BASE
// =======================================================

const CANDIDATE_FACTS = `
Candidate: Surya Prakash Pandey

Education:
- PGDM — Marketing (Major) & BAIT (Minor), Institute of Management Technology, Nagpur, 2027, 8.04
- B.Com (Hons), Seth Anandram Jaipuria College, 2024, 73.86%
- 12th Commerce, Gyan Bharati Vidyapith, 2021, 69.73%
- 10th, Gyan Bharati Vidyapith, 2019, 62.38%

Internship:
- Marketing Intern, Blue Star Ltd, April 2026 – July 2026
- Supported end-to-end execution of Blue Star's ₹6.5 Cr multi-city launch of 4 commercial HVAC products through marketing communication, event planning and stakeholder coordination.
- Updated 17 product brochures, saving ₹85,000 in agency costs while ensuring technical accuracy and brand consistency.
- Created 100+ marketing creatives, 8+ executive presentations, 2 corporate videos and 2 leadership video shoots.
- Negotiated with 23+ hotels and coordinated vendors, logistics and booth operations.

Projects:
- Technician-Friendly Installation Guide
- General Mills — Marketing & Commercial Intelligence Dashboard
- AI-Driven B2B Prospecting & Client Acquisition — The Insignia Consultant
- Consumer Research on Sunscreen Brand Switching
- Customer Purchase Behaviour Analytics Dashboard

Skills:
- Excel, Power Query, Power Pivot, DAX, Power BI, Tableau, SQL Basic
- Canva, Microsoft PowerPoint, Presentation Design, Visual Communication
- ChatGPT, Gemini, Claude, Google AI Studio
- Stakeholder Management, Leadership, Ownership

Achievements:
- Runner-up — Concord, IMT Nagpur
- Rajya Puraskar Award — Bharat Scouts & Guides
- Jila Puraskar — Bharat Scouts & Guides

Extra-curricular:
- Institution Industry Partnership Cell — IMT Nagpur
- Cubmaster — Bharat Scouts & Guides
- Bharat Scouts & Guides — 10+ years; Contingent Leader at 2nd Indo-Bangladesh Scout Friendship Camp

Certifications:
- Inbound Marketing Certification — HubSpot Academy
- Marketing & Retail Analytics — Great Learning
- Smart Marketing with Price Psychology — Udemy
- AI Tools & ChatGPT Workshop — BE10X
- Data Analytics Job Simulation — Deloitte Forage

Languages:
Hindi, English and Bengali

Interests:
Brand Storytelling, Geopolitics & Global Affairs, Film & Music Analysis
`;

// =======================================================
// HELPERS
// =======================================================

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
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

function sanitizeFilename(value) {
  return String(value || 'resume')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function extractVisibleText(paragraphXml) {
  const matches = [
    ...String(paragraphXml).matchAll(
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
    )
  ];

  let text = '';

  for (const match of matches) {
    text += decodeXml(match[1]);
  }

  return text;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function replaceParagraphText(
  paragraphXml,
  replacement
) {
  const escaped = escapeXml(
    replacement
  );

  let first = true;

  return paragraphXml.replace(
    /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,
    (full, open, text, close) => {

      if (first) {
        first = false;
        return (
          open +
          escaped +
          close
        );
      }

      return (
        open +
        '' +
        close
      );
    }
  );
}

function daysAgo(value) {

  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return (
    Date.now() -
    date.getTime()
  ) /
  (1000 * 60 * 60 * 24);
}

// =======================================================
// APPWRITE REST HELPERS
// =======================================================

function appwriteHeaders(
  projectId,
  apiKey
) {
  return {
    'X-Appwrite-Project':
      projectId,

    'X-Appwrite-Key':
      apiKey
  };
}

async function appwriteRequest(
  url,
  options = {},
  projectId,
  apiKey
) {

  const response =
    await fetch(
      url,
      {
        ...options,

        headers: {
          ...appwriteHeaders(
            projectId,
            apiKey
          ),

          ...(options.headers || {})
        }
      }
    );

  const body =
    await response.text();

  if (!response.ok) {

    throw new Error(
      `Appwrite ${response.status}: ${body.slice(0, 500)}`
    );
  }

  return {
    response,
    body
  };
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
    `${endpoint}/storage/buckets/` +
    `${RESUME_BUCKET_ID}/files?limit=100`;

  const result =
    await appwriteRequest(
      url,
      {},
      projectId,
      apiKey
    );

  const data =
    JSON.parse(
      result.body
    );

  const files =
    Array.isArray(
      data.files
    )
      ? data.files
      : [];

  /*
    Prefer the exact filename.
    If multiple copies exist, use the newest.
  */

  const exact =
    files
      .filter(
        file =>
          file.name ===
          MASTER_CV_FILENAME
      )
      .sort(
        (a, b) =>
          new Date(
            b.$createdAt
          ).getTime() -
          new Date(
            a.$createdAt
          ).getTime()
      );

  if (
    exact.length > 0
  ) {
    return exact[0];
  }

  const fallback =
    files
      .filter(
        file =>
          normalize(
            file.name
          ).includes(
            normalize(
              'MASTER CV'
            )
          ) &&
          normalize(
            file.name
          ).endsWith(
            '.docx'
          )
      )
      .sort(
        (a, b) =>
          new Date(
            b.$createdAt
          ).getTime() -
          new Date(
            a.$createdAt
          ).getTime()
      );

  if (
    fallback.length > 0
  ) {
    return fallback[0];
  }

  throw new Error(
    `Master CV "${MASTER_CV_FILENAME}" was not found in Resume Files bucket.`
  );
}

// =======================================================
// DOWNLOAD MASTER CV
// =======================================================

async function downloadFile(
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
        headers:
          appwriteHeaders(
            projectId,
            apiKey
          )
      }
    );

  if (
    !response.ok
  ) {

    const text =
      await response.text();

    throw new Error(
      `Master CV download failed: ${response.status} ${text.slice(0, 300)}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

// =======================================================
// UPLOAD CUSTOMIZED CV
// =======================================================

async function uploadFile(
  endpoint,
  projectId,
  apiKey,
  buffer,
  filename
) {

  const url =
    `${endpoint}/storage/buckets/` +
    `${RESUME_BUCKET_ID}/files`;

  const form =
    new FormData();

  form.append(
    'fileId',
    ID.unique()
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
    filename
  );

  const response =
    await fetch(
      url,
      {
        method: 'POST',

        headers:
          appwriteHeaders(
            projectId,
            apiKey
          ),

        body:
          form
      }
    );

  const body =
    await response.text();

  if (
    !response.ok
  ) {

    throw new Error(
      `Customized CV upload failed: ${response.status} ${body.slice(0, 500)}`
    );
  }

  return JSON.parse(
    body
  );
}

// =======================================================
// EXTRACT MASTER CV PARAGRAPHS
// =======================================================

function buildParagraphMap(
  documentXml
) {

  const blocks =
    documentXml.match(
      /<w:p\b[\s\S]*?<\/w:p>/g
    ) || [];

  const paragraphs = [];

  let counter = 1;

  for (
    const block
    of blocks
  ) {

    const text =
      extractVisibleText(
        block
      );

    if (
      !text.trim()
    ) {
      continue;
    }

    paragraphs.push({
      id:
        `P${counter}`,

      text,

      normalized:
        normalize(text),

      xml:
        block
    });

    counter++;
  }

  return paragraphs;
}

// =======================================================
// CREATE GEMINI EDIT PLAN
// =======================================================

async function createEditPlan(
  geminiApiKey,
  job,
  paragraphs
) {

  const prompt = `
You are the Resume Customization Agent.

Your task is to create a CONTENT-ONLY edit plan for the candidate's master CV.

ABSOLUTE RULES:

1. The master CV format is LOCKED.
2. Do not redesign it.
3. Do not change fonts, font sizes, colors, margins, spacing, layout, bullets, section order or styling.
4. Do not invent ANY qualification, experience, number, employer, skill, achievement or result.
5. Use only facts supported by the candidate truth base and the master CV paragraphs.
6. The final CV MUST fit one page.
7. Content removal is allowed and expected.
8. Content rewriting is allowed only where the rewritten statement remains factually equivalent to the candidate's documented experience.
9. Keep the Internship section because it contains the strongest documented professional evidence.
10. Keep PGDM and Graduation. 12th and 10th may be removed for space.
11. Select at most 3 projects.
12. Select at most 3 certifications.
13. Select at most 2 achievements.
14. Keep only the most relevant extracurricular entries.
15. Keep only the most relevant skill lines.
16. Keep the summary concise: maximum 360 characters.
17. Each rewritten project bullet must be maximum 240 characters.
18. Do not rewrite internship bullets in this first version because they contain carefully formatted evidence.
19. Never remove the section headings themselves.
20. The goal is ONE PAGE, not maximum content.

JOB:

Title:
${job.job_title}

Company:
${job.company_name}

Location:
${job.location || 'Unknown'}

Job description:
${String(job.job_description || '').slice(0, 14000)}

CANDIDATE TRUTH BASE:
${CANDIDATE_FACTS}

MASTER CV PARAGRAPHS:

${paragraphs
  .map(
    p =>
      `${p.id}: ${p.text}`
  )
  .join('\n')}

Return ONLY valid JSON in this exact structure:

{
  "summaryRewrite": "string",
  "removeIds": ["P1", "P2"],
  "projectRewrites": {
    "P23": "rewritten bullet",
    "P25": "rewritten bullet"
  },
  "keepProjectIds": ["P22", "P24", "P26"],
  "keepCertificationIds": ["P33", "P34", "P37"],
  "keepAchievementIds": ["P45", "P46"],
  "keepExtraCurricularIds": ["P49", "P50", "P53", "P54"],
  "keepSkillIds": ["P39", "P40", "P41"],
  "keepOtherInfoIds": ["P57"],
  "reason": "one concise sentence"
}
`;

  const response =
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
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
                3500,

              responseMimeType:
                'application/json'
            }
          })
      }
    );

  const body =
    await response.text();

  if (
    !response.ok
  ) {

    throw new Error(
      `Gemini ${response.status}: ${body.slice(0, 500)}`
    );
  }

  const data =
    JSON.parse(
      body
    );

  const raw =
    data?.candidates?.[0]?.content?.parts
      ?.map(
        part => part.text || ''
      )
      .join('') || '';

  if (!raw) {

    throw new Error(
      'Gemini returned no edit plan.'
    );
  }

  const clean =
    raw
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

  return JSON.parse(
    clean
  );
}

// =======================================================
// APPLY EDIT PLAN
// =======================================================

function applyEditPlan(
  documentXml,
  paragraphs,
  plan
) {

  const paragraphById =
    new Map(
      paragraphs.map(
        p => [
          p.id,
          p
        ]
      )
    );

  const removeIds =
    new Set(
      Array.isArray(
        plan.removeIds
      )
        ? plan.removeIds
        : []
    );

  // ---------------------------------------------------
  // Remove anything AI explicitly selected.
  // ---------------------------------------------------

  let output =
    documentXml;

  for (
    const paragraph
    of paragraphs
  ) {

    if (
      removeIds.has(
        paragraph.id
      )
    ) {

      output =
        output.replace(
          paragraph.xml,
          ''
        );
    }
  }

  // ---------------------------------------------------
  // Remove project entries not selected.
  // ---------------------------------------------------

  const allProjectPairs = [
    ['P22', 'P23'],
    ['P24', 'P25'],
    ['P26', 'P27'],
    ['P28', 'P29'],
    ['P30', 'P31']
  ];

  const keepProjectIds =
    new Set(
      Array.isArray(
        plan.keepProjectIds
      )
        ? plan.keepProjectIds
        : []
    );

  for (
    const [
      titleId,
      bulletId
    ]
    of allProjectPairs
  ) {

    if (
      keepProjectIds.size > 0 &&
      !keepProjectIds.has(
        titleId
      )
    ) {

      const title =
        paragraphById.get(
          titleId
        );

      const bullet =
        paragraphById.get(
          bulletId
        );

      if (title) {
        output =
          output.replace(
            title.xml,
            ''
          );
      }

      if (bullet) {
        output =
          output.replace(
            bullet.xml,
            ''
          );
      }
    }
  }

  // ---------------------------------------------------
  // Certifications
  // ---------------------------------------------------

  const certificationIds = [
    'P33',
    'P34',
    'P35',
    'P36',
    'P37'
  ];

  const keptCerts =
    new Set(
      Array.isArray(
        plan.keepCertificationIds
      )
        ? plan.keepCertificationIds
        : []
    );

  if (
    keptCerts.size > 0
  ) {

    for (
      const id
      of certificationIds
    ) {

      if (
        !keptCerts.has(id)
      ) {

        const paragraph =
          paragraphById.get(id);

        if (paragraph) {

          output =
            output.replace(
              paragraph.xml,
              ''
            );
        }
      }
    }
  }

  // ---------------------------------------------------
  // Achievements
  // ---------------------------------------------------

  const achievementIds = [
    'P45',
    'P46',
    'P47'
  ];

  const keptAchievements =
    new Set(
      Array.isArray(
        plan.keepAchievementIds
      )
        ? plan.keepAchievementIds
        : []
    );

  if (
    keptAchievements.size > 0
  ) {

    for (
      const id
      of achievementIds
    ) {

      if (
        !keptAchievements.has(id)
      ) {

        const paragraph =
          paragraphById.get(id);

        if (paragraph) {

          output =
            output.replace(
              paragraph.xml,
              ''
            );
        }
      }
    }
  }

  // ---------------------------------------------------
  // Skills
  // ---------------------------------------------------

  const skillIds = [
    'P39',
    'P40',
    'P41',
    'P42',
    'P43'
  ];

  const keptSkills =
    new Set(
      Array.isArray(
        plan.keepSkillIds
      )
        ? plan.keepSkillIds
        : []
    );

  if (
    keptSkills.size > 0
  ) {

    for (
      const id
      of skillIds
    ) {

      if (
        !keptSkills.has(id)
      ) {

        const paragraph =
          paragraphById.get(id);

        if (paragraph) {

          output =
            output.replace(
              paragraph.xml,
              ''
            );
        }
      }
    }
  }

  // ---------------------------------------------------
  // Extra-curricular
  // ---------------------------------------------------

  const extraIds = [
    'P49',
    'P50',
    'P51',
    'P52',
    'P53',
    'P54'
  ];

  const keptExtra =
    new Set(
      Array.isArray(
        plan.keepExtraCurricularIds
      )
        ? plan.keepExtraCurricularIds
        : []
    );

  /*
    Keep a sensible default if the model fails
    to return an extracurricular selection.
  */

  if (
    keptExtra.size > 0
  ) {

    for (
      const id
      of extraIds
    ) {

      if (
        !keptExtra.has(id)
      ) {

        const paragraph =
          paragraphById.get(id);

        if (paragraph) {

          output =
            output.replace(
              paragraph.xml,
              ''
            );
        }
      }
    }
  }

  // ---------------------------------------------------
  // Other information
  // ---------------------------------------------------

  const otherIds = [
    'P57',
    'P58'
  ];

  const keptOther =
    new Set(
      Array.isArray(
        plan.keepOtherInfoIds
      )
        ? plan.keepOtherInfoIds
        : ['P57']
    );

  for (
    const id
    of otherIds
  ) {

    if (
      !keptOther.has(id)
    ) {

      const paragraph =
        paragraphById.get(id);

      if (paragraph) {

        output =
          output.replace(
            paragraph.xml,
            ''
          );
      }
    }
  }

  // ---------------------------------------------------
  // Remove school-level education for space.
  // ---------------------------------------------------

  const optionalEducationIds = [
    'P11',
    'P12',
    'P13',
    'P14'
  ];

  for (
    const id
    of optionalEducationIds
  ) {

    const paragraph =
      paragraphById.get(id);

    if (paragraph) {

      output =
        output.replace(
          paragraph.xml,
          ''
        );
    }
  }

  // ---------------------------------------------------
  // Rewrite summary.
  // ---------------------------------------------------

  if (
    plan.summaryRewrite &&
    paragraphById.has('P5')
  ) {

    const original =
      paragraphById.get(
        'P5'
      );

    /*
      Important:
      P5 is a single normal text run in the
      master document, so formatting stays intact.
    */

    const replacement =
      String(
        plan.summaryRewrite
      )
        .trim()
        .slice(
          0,
          360
        );

    output =
      output.replace(
        original.xml,
        replaceParagraphText(
          original.xml,
          replacement
        )
      );
  }

  // ---------------------------------------------------
  // Rewrite selected project bullets.
  // ---------------------------------------------------

  const projectRewrites =
    plan.projectRewrites &&
    typeof plan.projectRewrites === 'object'
      ? plan.projectRewrites
      : {};

  for (
    const [
      id,
      replacement
    ]
    of Object.entries(
      projectRewrites
    )
  ) {

    if (
      !paragraphById.has(id)
    ) {
      continue;
    }

    const original =
      paragraphById.get(id);

    const cleanReplacement =
      String(
        replacement || ''
      )
        .trim()
        .slice(
          0,
          240
        );

    if (
      !cleanReplacement
    ) {
      continue;
    }

    output =
      output.replace(
        original.xml,
        replaceParagraphText(
          original.xml,
          cleanReplacement
        )
      );
  }

  // ---------------------------------------------------
  // Remove cached page-break information.
  // ---------------------------------------------------

  output =
    output.replace(
      /<w:lastRenderedPageBreak\s*\/>/g,
      ''
    );

  return output;
}

// =======================================================
// FALLBACK ONE-PAGE TRIMMER
// =======================================================

function trimToOnePageBudget(
  documentXml
) {

  function visibleChars(
    xml
  ) {

    return extractVisibleText(
      `<w:p>${xml.match(/<w:p\b[\s\S]*?<\/w:p>/g)?.join('') || ''}</w:p>`
    ).length;
  }

  let output =
    documentXml;

  let current =
    visibleChars(
      output
    );

  if (
    current <= MAX_ONE_PAGE_CHARS
  ) {
    return {
      xml:
        output,

      chars:
        current,

      trimmed:
        false
    };
  }

  /*
    These are the safest low-priority blocks
    to remove when the one-page budget is exceeded.

    Each pair is TITLE + BODY.
  */

  const removalGroups = [

    // Hobbies
    ['P58'],

    // Cubmaster
    ['P51', 'P52'],

    // Second Scouts entry
    ['P53', 'P54'],

    // Extra achievement
    ['P47'],

    // Competition achievement
    ['P45'],

    // Lowest-priority certification entries
    ['P37'],
    ['P36'],
    ['P35'],
    ['P34'],

    // Extra skill lines
    ['P43'],
    ['P42'],

    // Project options
    ['P30', 'P31'],
    ['P28', 'P29'],
    ['P22', 'P23'],

    // Final extracurricular body
    ['P50'],

    // Remaining achievement
    ['P46']
  ];

  const paragraphs =
    output.match(
      /<w:p\b[\s\S]*?<\/w:p>/g
    ) || [];

  for (
    const group
    of removalGroups
  ) {

    for (
      const id
      of group
    ) {

      const original =
        paragraphs.find(
          paragraph =>
            paragraphToStableId(
              paragraph
            ) === id
        );

      if (
        original
      ) {

        output =
          output.replace(
            original,
            ''
          );
      }
    }

    current =
      visibleChars(
        output
      );

    if (
      current <=
      MAX_ONE_PAGE_CHARS
    ) {

      return {
        xml:
          output,

        chars:
          current,

        trimmed:
          true
      };
    }
  }

  return {
    xml:
      output,

    chars:
      current,

    trimmed:
      true
  };
}

function paragraphToStableId(
  paragraphXml
) {

  /*
    This fallback mapper is based on the
    stable paragraph order of the master CV.
    It is only used after the master is parsed
    in its original order.
  */

  return null;
}

// =======================================================
// BETTER ONE-PAGE TRIMMER
// =======================================================

function trimUsingParagraphMap(
  documentXml,
  paragraphs
) {

  function chars(xml) {

    const blocks =
      xml.match(
        /<w:p\b[\s\S]*?<\/w:p>/g
      ) || [];

    return blocks.reduce(
      (
        total,
        block
      ) =>
        total +
        extractVisibleText(
          block
        ).length,
      0
    );
  }

  let output =
    documentXml;

  let current =
    chars(
      output
    );

  if (
    current <= MAX_ONE_PAGE_CHARS
  ) {

    return {
      xml:
        output,

      chars:
        current,

      trimmed:
        false,

      passed:
        true
    };
  }

  const removals = [

    ['P58'],

    ['P51', 'P52'],

    ['P53', 'P54'],

    ['P47'],

    ['P45'],

    ['P37'],

    ['P36'],

    ['P35'],

    ['P34'],

    ['P43'],

    ['P42'],

    ['P30', 'P31'],

    ['P28', 'P29'],

    ['P22', 'P23'],

    ['P50'],

    ['P46'],

    ['P41'],

    ['P40']
  ];

  const map =
    new Map(
      paragraphs.map(
        p => [
          p.id,
          p.xml
        ]
      )
    );

  for (
    const group
    of removals
  ) {

    for (
      const id
      of group
    ) {

      const block =
        map.get(id);

      if (block) {

        output =
          output.replace(
            block,
            ''
          );
      }
    }

    current =
      chars(
        output
      );

    if (
      current <=
      MAX_ONE_PAGE_CHARS
    ) {

      return {
        xml:
          output,

        chars:
          current,

        trimmed:
          true,

        passed:
          true
      };
    }
  }

  return {
    xml:
      output,

    chars:
      current,

    trimmed:
      true,

    passed:
      false
  };
}

// =======================================================
// UPDATE DOCX METADATA
// =======================================================

function updateDocProperties(
  zip,
  visibleChars
) {

  const appFile =
    zip.file(
      'docProps/app.xml'
    );

  if (!appFile) {
    return;
  }

  let xml =
    appFile
      .async('text');

  return xml.then(
    appXml => {

      appXml =
        appXml.replace(
          /<Pages>\d+<\/Pages>/i,
          '<Pages>1</Pages>'
        );

      const estimatedWords =
        Math.max(
          1,
          Math.round(
            visibleChars / 6
          )
        );

      appXml =
        appXml.replace(
          /<Words>\d+<\/Words>/i,
          `<Words>${estimatedWords}</Words>`
        );

      appXml =
        appXml.replace(
          /<Characters>\d+<\/Characters>/i,
          `<Characters>${visibleChars}</Characters>`
        );

      appXml =
        appXml.replace(
          /<CharactersWithSpaces>\d+<\/CharactersWithSpaces>/i,
          `<CharactersWithSpaces>${visibleChars}</CharactersWithSpaces>`
        );

      zip.file(
        'docProps/app.xml',
        appXml
      );
    }
  );
}

// =======================================================
// SELECT JOB
// =======================================================

async function selectJob(
  tablesDB,
  requestedJobId
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

  const jobs =
    response.rows || [];

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
        `Job ${requestedJobId} was not found in Jobs.`
      );
    }

    return requested;
  }

  const eligible =
    jobs.filter(
      job =>
        job.eligibility_status ===
          'ELIGIBLE' &&
        job.match_status !==
          'NOT_A_MATCH'
    );

  if (
    eligible.length === 0
  ) {

    throw new Error(
      'No eligible job is available for resume customization.'
    );
  }

  eligible.sort(
    (a, b) => {

      const aScore =
        Number(
          a.opportunity_score
        ) || 0;

      const bScore =
        Number(
          b.opportunity_score
        ) || 0;

      if (
        bScore !==
        aScore
      ) {

        return (
          bScore -
          aScore
        );
      }

      const aMatch =
        normalize(
          a.match_status
        );

      const bMatch =
        normalize(
          b.match_status
        );

      const rank = {
        high_match:
          3,

        medium_match:
          2,

        low_match:
          1
      };

      return (
        (rank[bMatch] || 0) -
        (rank[aMatch] || 0)
      );
    }
  );

  return eligible[0];
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

    const projectId =
      process.env
        .APPWRITE_FUNCTION_PROJECT_ID;

    const endpoint =
      process.env
        .APPWRITE_FUNCTION_API_ENDPOINT;

    const appwriteKey =
      process.env
        .JOB_AUTOMATION_API_KEY;

    const geminiKey =
      process.env
        .GEMINI_API_KEY;

    if (!projectId) {
      throw new Error(
        'APPWRITE_FUNCTION_PROJECT_ID is missing.'
      );
    }

    if (!endpoint) {
      throw new Error(
        'APPWRITE_FUNCTION_API_ENDPOINT is missing.'
      );
    }

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

    // ===================================================
    // REQUEST INPUT
    // ===================================================

    let body = {};

    try {

      if (
        req?.body &&
        typeof req.body ===
          'string'
      ) {

        body =
          JSON.parse(
            req.body
          );

      } else if (
        req?.bodyJson
      ) {

        body =
          req.bodyJson;
      }

    } catch {
      body = {};
    }

    const requestedJobId =
      body.jobId ||
      null;

    // ===================================================
    // SELECT ONE JOB
    // ===================================================

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

    const job =
      await selectJob(
        tablesDB,
        requestedJobId
      );

    if (
      job.eligibility_status !==
      'ELIGIBLE'
    ) {

      throw new Error(
        `Selected job is not ELIGIBLE: ${job.eligibility_status}`
      );
    }

    // ===================================================
    // FIND + DOWNLOAD MASTER CV
    // ===================================================

    const masterFile =
      await findMasterCv(
        endpoint,
        projectId,
        appwriteKey
      );

    const masterBuffer =
      await downloadFile(
        endpoint,
        projectId,
        appwriteKey,
        masterFile.$id
      );

    // ===================================================
    // OPEN DOCX
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
        'Invalid DOCX: word/document.xml not found.'
      );
    }

    const documentXml =
      await documentFile
        .async('text');

    const paragraphs =
      buildParagraphMap(
        documentXml
      );

    // ===================================================
    // GEMINI EDIT PLAN
    // ===================================================

    const plan =
      await createEditPlan(
        geminiKey,
        job,
        paragraphs
      );

    // ===================================================
    // APPLY CONTENT EDITS
    // ===================================================

    let customizedXml =
      applyEditPlan(
        documentXml,
        paragraphs,
        plan
      );

    // ===================================================
    // ONE-PAGE CONTENT GATE
    // ===================================================

    const trimmed =
      trimUsingParagraphMap(
        customizedXml,
        paragraphs
      );

    customizedXml =
      trimmed.xml;

    if (
      !trimmed.passed
    ) {

      throw new Error(
        `ONE_PAGE_GATE_FAILED: customized content remained at ${trimmed.chars} characters; maximum allowed is ${MAX_ONE_PAGE_CHARS}. No CV was uploaded.`
      );
    }

    // ===================================================
    // WRITE DOCX XML
    // ===================================================

    zip.file(
      'word/document.xml',
      customizedXml
    );

    await updateDocProperties(
      zip,
      trimmed.chars
    );

    // ===================================================
    // BUILD OUTPUT
    // ===================================================

    const outputBuffer =
      await zip.generateAsync({
        type:
          'nodebuffer',

        compression:
          'DEFLATE',

        compressionOptions: {
          level: 6
        }
      });

    // ===================================================
    // FILE NAME
    // ===================================================

    const company =
      sanitizeFilename(
        job.company_name ||
        'Company'
      );

    const title =
      sanitizeFilename(
        job.job_title ||
        'Role'
      );

    const outputFilename =
      `${company} - ${title} - Tailored Resume.docx`;

    // ===================================================
    // UPLOAD
    // ===================================================

    const uploaded =
      await uploadFile(
        endpoint,
        projectId,
        appwriteKey,
        outputBuffer,
        outputFilename
      );

    // ===================================================
    // RESULT
    // ===================================================

    return res.json({

      status:
        'SUCCESS',

      onePageGate:
        'PASS',

      onePageBasis:
        'Conservative master-template content budget + cached page-break removal',

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

      masterCv: {
        fileId:
          masterFile.$id,

        filename:
          masterFile.name
      },

      customizedCv: {
        fileId:
          uploaded.$id,

        filename:
          uploaded.name
      },

      visibleCharacters:
        trimmed.chars,

      maxOnePageCharacters:
        MAX_ONE_PAGE_CHARS,

      aiReason:
        plan.reason ||
        'Content tailored to the selected job.',

      formatLocked:
        true,

      contentOnlyChanges:
        true
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
