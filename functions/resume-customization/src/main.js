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

const RESUME_BUCKET_ID = '6ac038600011e9e4bc37';
const MASTER_CV_FILENAME = 'MASTER CV FP(5).docx';

const MAX_ONE_PAGE_CHARS = 2600;

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

function decodeXml(value) {
  return String(value || '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
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

function extractParagraphs(documentXml) {
  return (
    String(documentXml).match(
      /<w:p\b[\s\S]*?<\/w:p>/g
    ) || []
  );
}

function replaceParagraphText(paragraphXml, replacement) {
  const escaped = escapeXml(replacement);

  const textMatches = [
    ...String(paragraphXml).matchAll(
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
    )
  ];

  if (textMatches.length === 0) {
    return paragraphXml;
  }

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

// =======================================================
// APPWRITE REST
// =======================================================

function appwriteHeaders(projectId, apiKey) {
  return {
    'X-Appwrite-Project': projectId,
    'X-Appwrite-Key': apiKey
  };
}

async function appwriteRequest(
  url,
  options,
  projectId,
  apiKey
) {
  const response = await fetch(
    url,
    {
      ...options,

      headers: {
        ...appwriteHeaders(
          projectId,
          apiKey
        ),

        ...(options?.headers || {})
      }
    }
  );

  const body = await response.text();

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

  const result = await appwriteRequest(
    url,
    {},
    projectId,
    apiKey
  );

  const data = JSON.parse(result.body);

  const files = Array.isArray(data.files)
    ? data.files
    : [];

  const exact = files
    .filter(
      file =>
        file.name === MASTER_CV_FILENAME
    )
    .sort(
      (a, b) =>
        new Date(b.$createdAt).getTime() -
        new Date(a.$createdAt).getTime()
    );

  if (exact.length > 0) {
    return exact[0];
  }

  const fallback = files
    .filter(
      file =>
        normalize(file.name).includes(
          normalize('MASTER CV')
        ) &&
        normalize(file.name).endsWith('.docx')
    )
    .sort(
      (a, b) =>
        new Date(b.$createdAt).getTime() -
        new Date(a.$createdAt).getTime()
    );

  if (fallback.length > 0) {
    return fallback[0];
  }

  throw new Error(
    `Master CV "${MASTER_CV_FILENAME}" was not found in Resume Files bucket ${RESUME_BUCKET_ID}.`
  );
}

// =======================================================
// DOWNLOAD FILE
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

  const response = await fetch(
    url,
    {
      headers: appwriteHeaders(
        projectId,
        apiKey
      )
    }
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Master CV download failed: ${response.status} ${text.slice(0, 300)}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

// =======================================================
// UPLOAD FILE
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

  const form = new FormData();

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

  const response = await fetch(
    url,
    {
      method: 'POST',

      headers:
        appwriteHeaders(
          projectId,
          apiKey
        ),

      body: form
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Customized CV upload failed: ${response.status} ${body.slice(0, 500)}`
    );
  }

  return JSON.parse(body);
}

// =======================================================
// BUILD PARAGRAPH MAP
// =======================================================

function buildParagraphMap(documentXml) {
  const blocks =
    extractParagraphs(documentXml);

  const paragraphs = [];

  let counter = 1;

  for (const block of blocks) {
    const text =
      extractVisibleText(block);

    if (!text.trim()) {
      continue;
    }

    paragraphs.push({
      id: `P${counter}`,
      text,
      normalized: normalize(text),
      xml: block
    });

    counter++;
  }

  return paragraphs;
}

// =======================================================
// GEMINI EDIT PLAN
// =======================================================

async function createEditPlan(
  geminiApiKey,
  job,
  paragraphs
) {
  const prompt = `
You are the Resume Customization Agent.

Create a CONTENT-ONLY edit plan for the candidate's existing master CV.

ABSOLUTE RULES:

1. The master CV format is LOCKED.
2. Never redesign the CV.
3. Never change fonts, font sizes, colors, margins, spacing, layout, bullets, section order or styling.
4. Never invent any qualification, experience, number, employer, skill, achievement or result.
5. Use only facts supported by the candidate truth base and master CV.
6. The final CV must remain one page.
7. Content removal is allowed.
8. Content rewriting is allowed only when factually equivalent.
9. Keep the Internship section.
10. Keep PGDM and Graduation.
11. 12th and 10th may be removed.
12. Select at most 3 projects.
13. Select at most 3 certifications.
14. Select at most 2 achievements.
15. Keep only the most relevant extracurricular entries.
16. Keep only the most relevant skill lines.
17. Keep summary <= 360 characters.
18. Each project rewrite <= 240 characters.
19. Do not rewrite internship bullets.
20. Do not remove section headings.
21. Optimize for job relevance while preserving truth.

JOB TITLE:
${job.job_title}

COMPANY:
${job.company_name}

LOCATION:
${job.location || 'Unknown'}

JOB DESCRIPTION:
${String(job.job_description || '').slice(0, 14000)}

CANDIDATE TRUTH BASE:
${CANDIDATE_FACTS}

MASTER CV PARAGRAPHS:
${paragraphs
  .map(p => `${p.id}: ${p.text}`)
  .join('\n')}

Return ONLY valid JSON:

{
  "summaryRewrite": "string",
  "removeIds": [],
  "projectRewrites": {},
  "keepProjectIds": [],
  "keepCertificationIds": [],
  "keepAchievementIds": [],
  "keepExtraCurricularIds": [],
  "keepSkillIds": [],
  "keepOtherInfoIds": [],
  "reason": "one concise sentence"
}
`;

  const url =
    `https://generativelanguage.googleapis.com/` +
    `v1beta/models/${GEMINI_MODEL}:generateContent` +
    `?key=${encodeURIComponent(geminiApiKey)}`;

  const response = await fetch(
    url,
    {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json'
      },

      body: JSON.stringify({
        contents: [
          {
            role: 'user',

            parts: [
              {
                text: prompt
              }
            ]
          }
        ],

        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 3500,
          responseMimeType:
            'application/json'
        }
      })
    }
  );

  const body =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Gemini ${response.status}: ${body.slice(0, 500)}`
    );
  }

  const data =
    JSON.parse(body);

  const raw =
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('') || '';

  if (!raw) {
    throw new Error(
      'Gemini returned no edit plan.'
    );
  }

  const clean =
    raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

  return JSON.parse(clean);
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
        p => [p.id, p]
      )
    );

  let output =
    documentXml;

  // ---------------------------------------------------
  // ONLY THESE PARAGRAPHS MAY BE REMOVED BY AI.
  // Internship paragraphs are deliberately excluded.
  // ---------------------------------------------------

  const removableIds =
    new Set([
      'P11',
      'P12',
      'P13',
      'P14',

      'P22',
      'P23',
      'P24',
      'P25',
      'P26',
      'P27',
      'P28',
      'P29',
      'P30',
      'P31',

      'P34',
      'P35',
      'P36',
      'P37',

      'P43',

      'P45',
      'P46',
      'P47',

      'P49',
      'P50',
      'P51',
      'P52',
      'P53',
      'P54',

      'P57',
      'P58'
    ]);

  const requestedRemovals =
    Array.isArray(plan.removeIds)
      ? plan.removeIds
      : [];

  for (
    const id of requestedRemovals
  ) {
    if (!removableIds.has(id)) {
      continue;
    }

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
  // PROJECTS
  // ---------------------------------------------------

  const projectPairs = [
    ['P22', 'P23'],
    ['P24', 'P25'],
    ['P26', 'P27'],
    ['P28', 'P29'],
    ['P30', 'P31']
  ];

  const requestedProjects =
    Array.isArray(
      plan.keepProjectIds
    )
      ? plan.keepProjectIds
      : [];

  const validProjects =
    projectPairs
      .map(pair => pair[0])
      .filter(
        id =>
          requestedProjects.includes(id)
      )
      .slice(0, 3);

  if (validProjects.length > 0) {
    for (
      const [
        titleId,
        bulletId
      ]
      of projectPairs
    ) {
      if (
        !validProjects.includes(
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
  }

  // ---------------------------------------------------
  // CERTIFICATIONS
  // ---------------------------------------------------

  const certificationIds = [
    'P33',
    'P34',
    'P35',
    'P36',
    'P37'
  ];

  const validCertifications =
    Array.isArray(
      plan.keepCertificationIds
    )
      ? plan.keepCertificationIds
          .filter(
            id =>
              certificationIds.includes(
                id
              )
          )
          .slice(0, 3)
      : [];

  if (
    validCertifications.length > 0
  ) {
    for (
      const id of certificationIds
    ) {
      if (
        !validCertifications.includes(
          id
        )
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
  // ACHIEVEMENTS
  // ---------------------------------------------------

  const achievementIds = [
    'P45',
    'P46',
    'P47'
  ];

  const validAchievements =
    Array.isArray(
      plan.keepAchievementIds
    )
      ? plan.keepAchievementIds
          .filter(
            id =>
              achievementIds.includes(
                id
              )
          )
          .slice(0, 2)
      : [];

  if (
    validAchievements.length > 0
  ) {
    for (
      const id of achievementIds
    ) {
      if (
        !validAchievements.includes(id)
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
  // SKILLS
  // ---------------------------------------------------

  const skillIds = [
    'P39',
    'P40',
    'P41',
    'P42',
    'P43'
  ];

  const validSkills =
    Array.isArray(
      plan.keepSkillIds
    )
      ? plan.keepSkillIds
          .filter(
            id =>
              skillIds.includes(id)
          )
      : [];

  if (
    validSkills.length > 0
  ) {
    for (
      const id of skillIds
    ) {
      if (
        !validSkills.includes(id)
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
  // EXTRA-CURRICULAR
  // ---------------------------------------------------

  const extraIds = [
    'P49',
    'P50',
    'P51',
    'P52',
    'P53',
    'P54'
  ];

  const validExtra =
    Array.isArray(
      plan.keepExtraCurricularIds
    )
      ? plan.keepExtraCurricularIds
          .filter(
            id =>
              extraIds.includes(id)
          )
      : [];

  if (
    validExtra.length > 0
  ) {
    for (
      const id of extraIds
    ) {
      if (
        !validExtra.includes(id)
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
  // OTHER INFORMATION
  // ---------------------------------------------------

  const otherIds = [
    'P57',
    'P58'
  ];

  const validOther =
    Array.isArray(
      plan.keepOtherInfoIds
    )
      ? plan.keepOtherInfoIds.filter(
          id =>
            otherIds.includes(id)
        )
      : ['P57'];

  for (
    const id of otherIds
  ) {
    if (
      !validOther.includes(id)
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
  // ALWAYS REMOVE SCHOOL-LEVEL EDUCATION
  // ---------------------------------------------------

  for (
    const id of [
      'P11',
      'P12',
      'P13',
      'P14'
    ]
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
  // SUMMARY
  // ---------------------------------------------------

  if (
    plan.summaryRewrite &&
    paragraphById.has('P5')
  ) {
    const original =
      paragraphById.get('P5');

    const replacement =
      String(
        plan.summaryRewrite
      )
        .trim()
        .slice(0, 360);

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
  // PROJECT REWRITES
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

    if (
      ![
        'P23',
        'P25',
        'P27',
        'P29',
        'P31'
      ].includes(id)
    ) {
      continue;
    }

    const cleanReplacement =
      String(
        replacement || ''
      )
        .trim()
        .slice(0, 240);

    if (
      !cleanReplacement
    ) {
      continue;
    }

    const original =
      paragraphById.get(id);

    output =
      output.replace(
        original.xml,
        replaceParagraphText(
          original.xml,
          cleanReplacement
        )
      );
  }

  // Remove stale cached page-break markers.
  output =
    output.replace(
      /<w:lastRenderedPageBreak\s*\/>/g,
      ''
    );

  return output;
}

// =======================================================
// ONE-PAGE CONTENT GATE
// =======================================================

function countVisibleCharacters(xml) {
  return extractParagraphs(xml)
    .reduce(
      (total, paragraph) =>
        total +
        extractVisibleText(
          paragraph
        ).length,
      0
    );
}

function trimUsingParagraphMap(
  documentXml,
  paragraphs
) {
  let output =
    documentXml;

  let current =
    countVisibleCharacters(
      output
    );

  if (
    current <=
    MAX_ONE_PAGE_CHARS
  ) {
    return {
      xml: output,
      chars: current,
      trimmed: false,
      passed: true
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
    const group of removals
  ) {
    for (
      const id of group
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
      countVisibleCharacters(
        output
      );

    if (
      current <=
      MAX_ONE_PAGE_CHARS
    ) {
      return {
        xml: output,
        chars: current,
        trimmed: true,
        passed: true
      };
    }
  }

  return {
    xml: output,
    chars: current,
    trimmed: true,
    passed: false
  };
}

// =======================================================
// DOCX METADATA
// =======================================================

async function updateDocProperties(
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

  let appXml =
    await appFile.async('text');

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
        normalize(
          job.match_status
        ) !==
          'not_a_match'
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

      const rank = {
        high_match: 3,
        medium_match: 2,
        low_match: 1
      };

      const aMatch =
        normalize(
          a.match_status
        );

      const bMatch =
        normalize(
          b.match_status
        );

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
    // APPWRITE CLIENT
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

    // ===================================================
    // SELECT JOB
    // ===================================================

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
      await documentFile.async(
        'text'
      );

    const paragraphs =
      buildParagraphMap(
        documentXml
      );

    if (
      paragraphs.length === 0
    ) {
      throw new Error(
        'Master CV contains no readable Word paragraphs.'
      );
    }

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
    // WRITE XML
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
    // BUILD DOCX
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
    // OUTPUT FILENAME
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

    log(
      `Resume customization succeeded for ${job.company_name} - ${job.job_title}`
    );

    return res.json(
      {
        status:
          'SUCCESS',

        onePageGate:
          'PASS',

        onePageBasis:
          'Conservative master-template content budget',

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
      }
    );
  } catch (err) {
    const message =
      err?.message ||
      String(err);

    error(message);

    return res.json(
      {
        status:
          'FAILED',

        error:
          message
      },
      500
    );
  }
};
