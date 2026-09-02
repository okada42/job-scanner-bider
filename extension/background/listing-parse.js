const JOB_SPECS = {
  crowdworks: {
    pattern: /\/public\/jobs\/(\d+)/,
    abs: (id) => `https://crowdworks.jp/public/jobs/${id}`,
  },
  lancers: {
    pattern: /\/work\/detail\/(\d+)/,
    abs: (id) => `https://www.lancers.jp/work/detail/${id}`,
  },
  coconala: {
    pattern: /\/requests\/(\d+)/,
    abs: (id) => `https://coconala.com/requests/${id}`,
  },
};

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function usableTitle(title) {
  if (!title) return null;
  if (title.length > 200) return null;
  if (/^[\d\s./-]+$/.test(title)) return null;
  if (/^(\/|https?:)/i.test(title)) return null;
  return title;
}

function parseListingJobs(html, platform) {
  const spec = JOB_SPECS[platform];
  if (!spec || !html) return [];
  const jobs = new Map();

  const linkRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    const idMatch = m[1].match(spec.pattern);
    if (!idMatch) continue;
    const id = idMatch[1];
    const title = usableTitle(stripTags(m[2]));
    const prev = jobs.get(id);
    jobs.set(id, {
      platform,
      external_job_id: id,
      url: spec.abs(id),
      title: title || (prev && prev.title) || null,
    });
  }

  const loose = new RegExp(spec.pattern.source, "g");
  let lm;
  while ((lm = loose.exec(html))) {
    const id = lm[1];
    if (!jobs.has(id)) {
      jobs.set(id, {
        platform,
        external_job_id: id,
        url: spec.abs(id),
        title: null,
      });
    }
  }
  return [...jobs.values()];
}

self.parseListingJobs = parseListingJobs;
