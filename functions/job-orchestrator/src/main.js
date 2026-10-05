import { Client, TablesDB, ID, Query } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const tablesDB = new TablesDB(client);

    const tavilyKey =
      process.env.TAVILY_API_KEY || "";

    // =======================================================
    // HELPERS
    // =======================================================

    const existingSourceJobIds =
      new Set();

    const existingRows =
      await tablesDB.listRows({
        databaseId:
          '6aa03d1800119759c9bb',
        tableId:
          'jobs',
        queries: [
          Query.limit(100)
        ]
      });

    for (
      const row
      of existingRows.rows || []
    ) {
      if (row.source_job_id) {
        existingSourceJobIds.add(
          String(
            row.source_job_id
          )
        );
      }
    }

    function jobExists(sourceJobId) {
      return existingSourceJobIds.has(
        String(sourceJobId)
      );
    }

    // =======================================================
    // 1. REMOTIVE
    // =======================================================

    const remotiveCategories = [
      'marketing',
      'sales',
      'data-analysis'
    ];

    let remotiveFound = 0;
    let remotiveSaved = 0;
    let remotiveSkipped = 0;

    for (const category of remotiveCategories) {
      const response = await fetch(
        `https://remotive.com/api/remote-jobs?category=${category}&limit=10`
      );

      if (!response.ok) {
        throw new Error(
          `Remotive API returned ${response.status} for ${category}`
        );
      }

      const data = await response.json();

      remotiveFound += data.jobs.length;

      for (const job of data.jobs) {
        const sourceJobId = String(job.id);

        if (await jobExists(sourceJobId)) {
          remotiveSkipped++;
          continue;
        }

        const now = new Date().toISOString();

        await tablesDB.createRow({
          databaseId: '6aa03d1800119759c9bb',
          tableId: 'jobs',
          rowId: ID.unique(),
          data: {
            source: 'Remotive',
            job_title: job.title,
            company_name: job.company_name,
            job_url: job.url,
            location: job.candidate_required_location || 'Remote',
            job_description: job.description || '',
            job_type: job.job_type || 'Unknown',
            experience_required: 'Unknown',
            education_required: 'Unknown',
            salary_range: job.salary || 'Not disclosed',
            work_mode: 'Remote',
            industry: 'Unknown',
            department: category,
            function: category,
            company_size: 'Unknown',
            company_type: 'Unknown',
            job_posted_date: job.publication_date || null,
            application_deadline: null,
            job_status: 'OPEN',
            eligibility_status: 'UNKNOWN',
            match_status: 'UNKNOWN',
            application_status: 'NOT_APPLIED',
            discovery_date: now,
            job_id: `REMOTIVE_${sourceJobId}`,
            source_job_id: sourceJobId,
            company_id: null,
            source_platform: 'Remotive',
            first_seen_date: now,
            last_updated_date: now
          }
        });

        remotiveSaved++;
      }
    }

    // =======================================================
    // 2. HIMALAYAS
    // =======================================================

    const himalayasQueries = [
      'marketing',
      'sales',
      'business development',
      'data analyst'
    ];

    let himalayasFound = 0;
    let himalayasUnique = 0;
    let himalayasSaved = 0;
    let himalayasSkipped = 0;

    const seenHimalayasJobs = new Set();

    for (const searchTerm of himalayasQueries) {
      const url = new URL(
        'https://himalayas.app/jobs/api/search'
      );

      url.searchParams.set('q', searchTerm);
      url.searchParams.set('country', 'India');
      url.searchParams.set('sort', 'recent');
      url.searchParams.set('page', '1');

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Himalayas API returned ${response.status} for ${searchTerm}`
        );
      }

      const data = await response.json();

      himalayasFound += Array.isArray(data.jobs)
        ? data.jobs.length
        : 0;

      for (const job of data.jobs || []) {
        const guid = String(job.guid);

        if (seenHimalayasJobs.has(guid)) {
          continue;
        }

        seenHimalayasJobs.add(guid);
        himalayasUnique++;

        const sourceJobId = `HIMALAYAS_${guid}`;

        if (await jobExists(sourceJobId)) {
          himalayasSkipped++;
          continue;
        }

        const now = new Date().toISOString();

        let location = 'Worldwide';

        if (
          Array.isArray(job.locationRestrictions) &&
          job.locationRestrictions.length > 0
        ) {
          location = job.locationRestrictions
            .map(location => location.name || location.alpha2 || location)
            .filter(Boolean)
            .join(', ');
        }

        let salary = 'Not disclosed';

        if (
          job.minSalary !== null &&
          job.minSalary !== undefined
        ) {
          const min = Number(job.minSalary).toLocaleString();
          const max =
            job.maxSalary !== null &&
            job.maxSalary !== undefined
              ? Number(job.maxSalary).toLocaleString()
              : null;

          salary =
            `${job.currency || ''} ${min}` +
            (max ? ` - ${max}` : '') +
            ` ${job.salaryPeriod || 'annual'}`;
        }

        const postedDate =
          job.pubDate
            ? new Date(Number(job.pubDate)).toISOString()
            : null;

        const experience =
          Array.isArray(job.seniority) &&
          job.seniority.length > 0
            ? job.seniority.join(', ')
            : 'Unknown';

        const categories =
          Array.isArray(job.categories) &&
          job.categories.length > 0
            ? job.categories.join(', ')
            : 'Unknown';

        const parentCategories =
          Array.isArray(job.parentCategories) &&
          job.parentCategories.length > 0
            ? job.parentCategories.join(', ')
            : 'Unknown';

        await tablesDB.createRow({
          databaseId: '6aa03d1800119759c9bb',
          tableId: 'jobs',
          rowId: ID.unique(),
          data: {
            source: 'Himalayas',
            job_title: job.title || 'Unknown',
            company_name: job.companyName || 'Unknown',
            job_url: job.applicationLink || '',
            location,
            job_description:
              job.description ||
              job.excerpt ||
              '',
            job_type: job.employmentType || 'Unknown',
            experience_required: experience,
            education_required: 'Unknown',
            salary_range: salary,
            work_mode: 'Remote',
            industry: parentCategories,
            department: categories,
            function: searchTerm,
            company_size: 'Unknown',
            company_type: 'Unknown',
            job_posted_date: postedDate,
            application_deadline: null,
            job_status: 'OPEN',
            eligibility_status: 'UNKNOWN',
            match_status: 'UNKNOWN',
            application_status: 'NOT_APPLIED',
            discovery_date: now,
            job_id: sourceJobId,
            source_job_id: sourceJobId,
            company_id: null,
            source_platform: 'Himalayas',
            first_seen_date: now,
            last_updated_date: now
          }
        });

        himalayasSaved++;
      }
    }

    // =======================================================
       // =======================================================
        // =======================================================
    // 3. JOBICY
    // =======================================================

    let jobicyFound = 0;
    let jobicyMatched = 0;
    let jobicySaved = 0;
    let jobicySkipped = 0;
    let jobicyRequests = 0;
    let jobicyStatus = 'SUCCESS';

    try {
      const jobicyIndustries = [
        'marketing',
        'business',
        'seller',
        'data-science'
      ];

      const seenJobicyJobs = new Set();

      for (const industry of jobicyIndustries) {

        const url = new URL(
          'https://jobicy.com/api/v2/remote-jobs'
        );

        url.searchParams.set('count', '50');
        url.searchParams.set('geo', 'apac');
        url.searchParams.set('industry', industry);

        const response = await fetch(url);

        jobicyRequests++;

        if (!response.ok) {
          throw new Error(
            `Jobicy API returned ${response.status} for ${industry}`
          );
        }

        const data = await response.json();

        const jobs = Array.isArray(data.jobs)
          ? data.jobs
          : [];

        jobicyFound += jobs.length;

        for (const job of jobs) {

          const geo = String(
            job.jobGeo || ''
          ).toLowerCase();

          // India-specific or unrestricted remote roles.
          const indiaEligible =
            geo.includes('india') ||
            geo === 'anywhere';

          if (!indiaEligible) {
            continue;
          }

          const searchableText = [
            job.jobTitle,
            job.jobDescription,
            job.jobExcerpt,
            ...(Array.isArray(job.jobIndustry)
              ? job.jobIndustry
              : [])
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          const relevantKeywords = [
            'marketing',
            'brand',
            'branding',
            'growth',
            'digital marketing',
            'product marketing',
            'sales',
            'business development',
            'account management',
            'account executive',
            'inside sales',
            'revenue',
            'sales operations',
            'business analyst',
            'business analytics',
            'data analyst',
            'analytics',
            'business intelligence',
            'marketing analytics',
            'market research',
            'consumer research',
            'strategy'
          ];

          const relevant =
            relevantKeywords.some(keyword =>
              searchableText.includes(keyword)
            );

          if (!relevant) {
            continue;
          }

          const sourceJobId =
            `JOBICY_${String(job.id)}`;

          if (seenJobicyJobs.has(sourceJobId)) {
            continue;
          }

          seenJobicyJobs.add(sourceJobId);
          jobicyMatched++;

          if (await jobExists(sourceJobId)) {
            jobicySkipped++;
            continue;
          }

          const now = new Date().toISOString();

          const salary =
            job.salaryMin !== null &&
            job.salaryMin !== undefined
              ? `${job.salaryCurrency || ''} ${
                  Number(job.salaryMin).toLocaleString()
                }` +
                (
                  job.salaryMax !== null &&
                  job.salaryMax !== undefined
                    ? ` - ${Number(
                        job.salaryMax
                      ).toLocaleString()}`
                    : ''
                ) +
                ` ${job.salaryPeriod || ''}`
              : 'Not disclosed';

          await tablesDB.createRow({
            databaseId: '6aa03d1800119759c9bb',
            tableId: 'jobs',
            rowId: ID.unique(),
            data: {
              source: 'Jobicy',
              job_title: job.jobTitle || 'Unknown',
              company_name: job.companyName || 'Unknown',

              // Public API returns Jobicy listing URL.
              job_url: job.url || '',

              location: job.jobGeo || 'Anywhere',

              job_description:
                job.jobDescription ||
                job.jobExcerpt ||
                '',

              job_type:
                Array.isArray(job.jobType) &&
                job.jobType.length > 0
                  ? job.jobType.join(', ')
                  : 'Unknown',

              experience_required:
                job.jobLevel || 'Unknown',

              education_required: 'Unknown',

              salary_range: salary,

              work_mode: 'Remote',

              industry:
                Array.isArray(job.jobIndustry) &&
                job.jobIndustry.length > 0
                  ? job.jobIndustry.join(', ')
                  : industry,

              department: industry,
              function: industry,
              company_size: 'Unknown',
              company_type: 'Unknown',

              job_posted_date:
                job.pubDate || null,

              application_deadline: null,

              job_status: 'OPEN',
              eligibility_status: 'UNKNOWN',
              match_status: 'UNKNOWN',
              application_status: 'NOT_APPLIED',

              discovery_date: now,

              job_id: sourceJobId,
              source_job_id: sourceJobId,
              company_id: null,

              source_platform: 'Jobicy',

              first_seen_date: now,
              last_updated_date: now
            }
          });

          jobicySaved++;
        }
      }

    } catch (jobicyError) {
      jobicyStatus = 'PARTIAL_SUCCESS';
      error(`Jobicy: ${jobicyError.message}`);
    }

    // =======================================================

    // =======================================================
    // 4. WEB SEARCH DISCOVERY
    // =======================================================
    //
    // Search major job platforms through a web-search index
    // rather than scraping or bypassing platform protections.
    // This lets us surface LinkedIn, Internshala, Naukri,
    // Foundit, Cutshort, Wellfound and Indeed listings while
    // leaving login/CAPTCHA-protected application steps to
    // the human/browser stage.

    let webSearchFound = 0;
    let webSearchSaved = 0;
    let webSearchSkipped = 0;
    let webSearchQueries = 0;
    let webSearchStatus =
      tavilyKey
        ? 'SUCCESS'
        : 'NOT_CONFIGURED';

    const webSourceConfigs = [
      {
        source: 'LinkedIn',
        domain: 'linkedin.com',
        pathHint: '/jobs/view/',
        query:
          'MBA fresher entry level marketing sales business development market research jobs India'
      },
      {
        source: 'Internshala',
        domain: 'internshala.com',
        pathHint: '/job/detail/',
        query:
          'MBA fresher marketing sales business development analyst jobs India'
      },
      {
        source: 'Naukri',
        domain: 'naukri.com',
        pathHint: '/job-listings-',
        query:
          'MBA fresher marketing sales business development analyst jobs India'
      },
      {
        source: 'Foundit',
        domain: 'foundit.in',
        pathHint: '/job/',
        query:
          'MBA fresher marketing sales business development market research jobs India'
      },
      {
        source: 'Cutshort',
        domain: 'cutshort.io',
        pathHint: '/job/',
        query:
          'marketing sales business development market research jobs India entry level MBA'
      },
      {
        source: 'Wellfound',
        domain: 'wellfound.com',
        pathHint: '/jobs/',
        query:
          'marketing sales business development market research jobs India entry level'
      },
      {
        source: 'Indeed',
        domain: 'indeed.com',
        pathHint: '/viewjob',
        query:
          'MBA fresher marketing sales business development analyst jobs India'
      }
    ];

    function webSourceJobId(source, url) {
      const encoded =
        Buffer
          .from(
            String(url)
          )
          .toString(
            'base64url'
          )
          .slice(
            0,
            180
          );

      return (
        'WEB_' +
        source
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_') +
        '_' +
        encoded
      );
    }

    function looksLikeJobPage(config, url) {
      const normalizedUrl =
        String(
          url || ''
        ).toLowerCase();

      return (
        normalizedUrl.includes(
          config.domain
        ) &&
        normalizedUrl.includes(
          config.pathHint
        )
      );
    }

    function cleanWebText(value) {
      return String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (tavilyKey) {
      for (const config of webSourceConfigs) {
        try {
          const response =
            await fetch(
              'https://api.tavily.com/search',
              {
                method: 'POST',
                headers: {
                  Authorization:
                    `Bearer ${tavilyKey}`,
                  'Content-Type':
                    'application/json'
                },
                body:
                  JSON.stringify({
                    query:
                      config.query,
                    search_depth:
                      'basic',
                    max_results:
                      8,
                    topic:
                      'general',
                    time_range:
                      'week',
                    include_answer:
                      false,
                    include_raw_content:
                      false,
                    include_domains:
                      [config.domain]
                  })
              }
            );

          webSearchQueries++;

          if (!response.ok) {
            throw new Error(
              `Tavily ${response.status}`
            );
          }

          const data =
            await response.json();

          const results =
            Array.isArray(
              data.results
            )
              ? data.results
              : [];

          webSearchFound +=
            results.length;

          for (
            const result
            of results
          ) {
            const url =
              String(
                result.url || ''
              ).trim();

            if (
              !looksLikeJobPage(
                config,
                url
              )
            ) {
              continue;
            }

            const title =
              cleanWebText(
                result.title
              );

            const description =
              cleanWebText(
                result.content
              );

            if (
              !title &&
              !description
            ) {
              continue;
            }

            const sourceJobId =
              webSourceJobId(
                config.source,
                url
              );

            if (
              await jobExists(
                sourceJobId
              )
            ) {
              webSearchSkipped++;
              continue;
            }

            const now =
              new Date().toISOString();

            await tablesDB.createRow({
              databaseId:
                '6aa03d1800119759c9bb',
              tableId:
                'jobs',
              rowId:
                ID.unique(),
              data: {
                source:
                  config.source,

                job_title:
                  title ||
                  'Unknown',

                company_name:
                  'Unknown',

                job_url:
                  url,

                location:
                  'India / Remote',

                job_description:
                  description,

                job_type:
                  'Unknown',

                experience_required:
                  'Unknown',

                education_required:
                  'Unknown',

                salary_range:
                  'Not disclosed',

                work_mode:
                  'Remote / Hybrid',

                industry:
                  'Unknown',

                department:
                  'Unknown',

                function:
                  'Marketing / Sales / Analytics',

                company_size:
                  'Unknown',

                company_type:
                  'Unknown',

                job_posted_date:
                  result.published_date ||
                  null,

                application_deadline:
                  null,

                job_status:
                  'OPEN',

                eligibility_status:
                  'UNKNOWN',

                match_status:
                  'UNKNOWN',

                application_status:
                  'NOT_APPLIED',

                discovery_date:
                  now,

                job_id:
                  sourceJobId,

                source_job_id:
                  sourceJobId,

                company_id:
                  null,

                source_platform:
                  config.source,

                first_seen_date:
                  now,

                last_updated_date:
                  now
              }
            });

            webSearchSaved++;
          }
        } catch (webError) {
          webSearchStatus =
            'PARTIAL_SUCCESS';

          error(
            `${config.source}: ${webError.message}`
          );
        }
      }
    }

    // =======================================================
    // 4. REMOTE OK (free public JSON feed)
    // =======================================================

    let remoteOkFound = 0;
    let remoteOkMatched = 0;
    let remoteOkSaved = 0;
    let remoteOkSkipped = 0;
    let remoteOkStatus = 'SUCCESS';

    try {
      const remoteOkTags = [
        'marketing',
        'sales',
        'business',
        'analytics',
        'data-analysis'
      ];

      const seenRemoteOkJobs = new Set();

      for (const tag of remoteOkTags) {
        const url =
          'https://remoteok.com/api?tag=' +
          encodeURIComponent(tag);

        const response = await fetch(url, {
          headers: {
            'User-Agent':
              'PlacementCommandCenter/1.0'
          }
        });

        if (!response.ok) {
          throw new Error(
            `Remote OK API returned ${response.status} for ${tag}`
          );
        }

        const data = await response.json();
        const jobs =
          Array.isArray(data)
            ? data.filter(
                item =>
                  item &&
                  item.id &&
                  item.position
              )
            : [];

        remoteOkFound += jobs.length;

        for (const job of jobs) {
          const searchable =
            [
              job.position,
              job.company,
              job.description,
              ...(Array.isArray(job.tags)
                ? job.tags
                : [])
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();

          const relevant = [
            'marketing',
            'brand',
            'branding',
            'growth',
            'sales',
            'business development',
            'account management',
            'business analyst',
            'data analyst',
            'analytics',
            'business intelligence',
            'market research',
            'strategy'
          ].some(keyword =>
            searchable.includes(keyword)
          );

          if (!relevant) continue;

          const sourceJobId =
            `REMOTEOK_${String(job.id)}`;

          if (
            seenRemoteOkJobs.has(
              sourceJobId
            )
          ) {
            continue;
          }

          seenRemoteOkJobs.add(
            sourceJobId
          );

          remoteOkMatched++;

          if (
            await jobExists(
              sourceJobId
            )
          ) {
            remoteOkSkipped++;
            continue;
          }

          const now =
            new Date().toISOString();

          await tablesDB.createRow({
            databaseId:
              '6aa03d1800119759c9bb',
            tableId:
              'jobs',
            rowId:
              ID.unique(),
            data: {
              source:
                'Remote OK',

              job_title:
                job.position ||
                'Unknown',

              company_name:
                job.company ||
                'Unknown',

              job_url:
                job.url ||
                '',

              location:
                job.location ||
                'Worldwide',

              job_description:
                job.description ||
                '',

              job_type:
                'Unknown',

              experience_required:
                'Unknown',

              education_required:
                'Unknown',

              salary_range:
                job.salary_min ||
                job.salary_max
                  ? (
                      (
                        job.salary_min ||
                        ''
                      ) +
                      ' - ' +
                      (
                        job.salary_max ||
                        ''
                      )
                    ).trim()
                  : 'Not disclosed',

              work_mode:
                'Remote',

              industry:
                Array.isArray(
                  job.tags
                )
                  ? job.tags.join(', ')
                  : 'Unknown',

              department:
                'Remote',

              function:
                tag,

              company_size:
                'Unknown',

              company_type:
                'Unknown',

              job_posted_date:
                job.date ||
                null,

              application_deadline:
                null,

              job_status:
                'OPEN',

              eligibility_status:
                'UNKNOWN',

              match_status:
                'UNKNOWN',

              application_status:
                'NOT_APPLIED',

              discovery_date:
                now,

              job_id:
                sourceJobId,

              source_job_id:
                sourceJobId,

              company_id:
                null,

              source_platform:
                'Remote OK',

              first_seen_date:
                now,

              last_updated_date:
                now
            }
          });

          remoteOkSaved++;
        }
      }
    } catch (remoteOkError) {
      remoteOkStatus =
        'PARTIAL_SUCCESS';

      error(
        `Remote OK: ${remoteOkError.message}`
      );
    }

    // =======================================================
    // 5. WE WORK REMOTELY (public RSS feed)
    // =======================================================

    let wwrFound = 0;
    let wwrMatched = 0;
    let wwrSaved = 0;
    let wwrSkipped = 0;
    let wwrStatus = 'SUCCESS';

    function rssValue(xml, tagName) {
      const match =
        xml.match(
          new RegExp(
            `<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`,
            'i'
          )
        );

      if (!match) return '';

      return String(match[1])
        .replace(
          /^<!\[CDATA\[|\]\]>$/g,
          ''
        )
        .replace(
          /<[^>]+>/g,
          ' '
        )
        .replace(
          /&amp;/g,
          '&'
        )
        .replace(
          /&quot;/g,
          '"'
        )
        .replace(
          /&#39;/g,
          "'"
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
          /\s+/g,
          ' '
        )
        .trim();
    }

    try {
      const response =
        await fetch(
          'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',
          {
            headers: {
              'User-Agent':
                'PlacementCommandCenter/1.0'
            }
          }
        );

      if (!response.ok) {
        throw new Error(
          `We Work Remotely RSS returned ${response.status}`
        );
      }

      const xml =
        await response.text();

      const items =
        xml.match(
          /<item>[\s\S]*?<\/item>/gi
        ) || [];

      wwrFound = items.length;

      for (const item of items) {
        const title =
          rssValue(
            item,
            'title'
          );

        const link =
          rssValue(
            item,
            'link'
          );

        const description =
          rssValue(
            item,
            'description'
          );

        const pubDate =
          rssValue(
            item,
            'pubDate'
          );

        const searchable =
          (
            title +
            ' ' +
            description
          ).toLowerCase();

        const relevant = [
          'marketing',
          'brand',
          'branding',
          'growth',
          'sales',
          'business development',
          'account management',
          'strategy',
          'analytics'
        ].some(keyword =>
          searchable.includes(keyword)
        );

        if (
          !relevant ||
          !link
        ) {
          continue;
        }

        const sourceJobId =
          'WWR_' +
          link;

        wwrMatched++;

        if (
          await jobExists(
            sourceJobId
          )
        ) {
          wwrSkipped++;
          continue;
        }

        const now =
          new Date().toISOString();

        const parts =
          title.split(':');

        const company =
          parts.length > 1
            ? parts[0].trim()
            : 'Unknown';

        const role =
          parts.length > 1
            ? parts.slice(1).join(':').trim()
            : title;

        await tablesDB.createRow({
          databaseId:
            '6aa03d1800119759c9bb',
          tableId:
            'jobs',
          rowId:
            ID.unique(),
          data: {
            source:
              'We Work Remotely',

            job_title:
              role ||
              'Unknown',

            company_name:
              company ||
              'Unknown',

            job_url:
              link,

            location:
              'Remote',

            job_description:
              description ||
              '',

            job_type:
              'Unknown',

            experience_required:
              'Unknown',

            education_required:
              'Unknown',

            salary_range:
              'Not disclosed',

            work_mode:
              'Remote',

            industry:
              'Sales & Marketing',

            department:
              'Sales & Marketing',

            function:
              'sales-marketing',

            company_size:
              'Unknown',

            company_type:
              'Unknown',

            job_posted_date:
              pubDate
                ? new Date(
                    pubDate
                  ).toISOString()
                : null,

            application_deadline:
              null,

            job_status:
              'OPEN',

            eligibility_status:
              'UNKNOWN',

            match_status:
              'UNKNOWN',

            application_status:
              'NOT_APPLIED',

            discovery_date:
              now,

            job_id:
              sourceJobId,

            source_job_id:
              sourceJobId,

            company_id:
              null,

            source_platform:
              'We Work Remotely',

            first_seen_date:
              now,

            last_updated_date:
              now
          }
        });

        wwrSaved++;
      }
    } catch (wwrError) {
      wwrStatus =
        'PARTIAL_SUCCESS';

      error(
        `We Work Remotely: ${wwrError.message}`
      );
    }

    // =======================================================
    // 6. REMOTE LANDERS (free public ATS-direct API)
    // =======================================================

    let remoteLandersFound = 0;
    let remoteLandersMatched = 0;
    let remoteLandersSaved = 0;
    let remoteLandersSkipped = 0;
    let remoteLandersStatus = 'SUCCESS';

    try {
      const response =
        await fetch(
          'https://remotelanders.com/api/jobs?limit=100&page=1',
          {
            headers: {
              'User-Agent':
                'PlacementCommandCenter/1.0'
            }
          }
        );

      if (!response.ok) {
        throw new Error(
          `Remote Landers API returned ${response.status}`
        );
      }

      const data =
        await response.json();

      const jobs =
        Array.isArray(
          data.jobs
        )
          ? data.jobs
          : [];

      remoteLandersFound =
        jobs.length;

      for (const job of jobs) {
        const searchable =
          [
            job.title,
            job.category,
            job.subtags,
            job.company
          ]
            .flat()
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        const relevant = [
          'marketing',
          'sales',
          'business development',
          'account management',
          'growth',
          'brand',
          'strategy',
          'analytics',
          'market research',
          'business intelligence',
          'data'
        ].some(keyword =>
          searchable.includes(
            keyword
          )
        );

        if (!relevant) {
          continue;
        }

        const sourceJobId =
          'REMOTELANDERS_' +
          String(
            job.slug
          );

        remoteLandersMatched++;

        if (
          await jobExists(
            sourceJobId
          )
        ) {
          remoteLandersSkipped++;
          continue;
        }

        const now =
          new Date().toISOString();

        await tablesDB.createRow({
          databaseId:
            '6aa03d1800119759c9bb',
          tableId:
            'jobs',
          rowId:
            ID.unique(),
          data: {
            source:
              'Remote Landers',

            job_title:
              job.title ||
              'Unknown',

            company_name:
              job.company ||
              'Unknown',

            job_url:
              job.applyUrl ||
              job.url ||
              '',

            location:
              job.location ||
              'Worldwide',

            job_description:
              '',

            job_type:
              job.type ||
              'Unknown',

            experience_required:
              job.level ||
              'Unknown',

            education_required:
              'Unknown',

            salary_range:
              job.salary ||
              'Not disclosed',

            work_mode:
              'Remote',

            industry:
              job.category ||
              'Unknown',

            department:
              job.category ||
              'Unknown',

            function:
              Array.isArray(
                job.subtags
              )
                ? job.subtags.join(', ')
                : '',

            company_size:
              'Unknown',

            company_type:
              'Unknown',

            job_posted_date:
              job.postedDate ||
              null,

            application_deadline:
              null,

            job_status:
              'OPEN',

            eligibility_status:
              'UNKNOWN',

            match_status:
              'UNKNOWN',

            application_status:
              'NOT_APPLIED',

            discovery_date:
              now,

            job_id:
              sourceJobId,

            source_job_id:
              sourceJobId,

            company_id:
              null,

            source_platform:
              'Remote Landers',

            first_seen_date:
              now,

            last_updated_date:
              now
          }
        });

        remoteLandersSaved++;
      }
    } catch (remoteLandersError) {
      remoteLandersStatus =
        'PARTIAL_SUCCESS';

      error(
        `Remote Landers: ${remoteLandersError.message}`
      );
    }

    // RESULT
    // =======================================================

    return res.json({
      status: 'SUCCESS',

      remotive: {
        categories: remotiveCategories,
        jobsFound: remotiveFound,
        jobsSaved: remotiveSaved,
        jobsSkippedAsDuplicate: remotiveSkipped
      },

      himalayas: {
        searchTerms: himalayasQueries,
        jobsFound: himalayasFound,
        uniqueJobs: himalayasUnique,
        jobsSaved: himalayasSaved,
        jobsSkippedAsDuplicate: himalayasSkipped
      },

      jobicy: {
        status: jobicyStatus,
        jobsFound: jobicyFound,
        relevantJobsMatched: jobicyMatched,
        jobsSaved: jobicySaved,
        jobsSkippedAsDuplicate: jobicySkipped,
        requestsMade: jobicyRequests
      },

      webSearch: {
        status:
          webSearchStatus,
        platforms:
          webSourceConfigs.map(
            item => item.source
          ),
        jobsFound:
          webSearchFound,
        jobsSaved:
          webSearchSaved,
        jobsSkippedAsDuplicate:
          webSearchSkipped,
        queriesMade:
          webSearchQueries
      },

      remoteOk: {
        status: remoteOkStatus,
        tags: remoteOkTags,
        jobsFound: remoteOkFound,
        relevantJobsMatched: remoteOkMatched,
        jobsSaved: remoteOkSaved,
        jobsSkippedAsDuplicate: remoteOkSkipped
      },

      weWorkRemotely: {
        status: wwrStatus,
        jobsFound: wwrFound,
        relevantJobsMatched: wwrMatched,
        jobsSaved: wwrSaved,
        jobsSkippedAsDuplicate: wwrSkipped
      },

      remoteLanders: {
        status: remoteLandersStatus,
        jobsFound: remoteLandersFound,
        relevantJobsMatched: remoteLandersMatched,
        jobsSaved: remoteLandersSaved,
        jobsSkippedAsDuplicate: remoteLandersSkipped
      }
    });

  } catch (err) {
    error(err.message);

    return res.json({
      status: 'FAILED',
      error: err.message
    }, 500);
  }
};
