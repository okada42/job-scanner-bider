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

function unescapeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function boolish(value) {
  if (value === true || value === false) return value;
  return null;
}

function parseEmbeddedData(html, elementId) {
  const re = new RegExp(`id=["']${elementId}["'][^>]*\\bdata=["']([^"']*)["']`, "i");
  let match = html.match(re);
  if (!match) {
    match = html.match(new RegExp(`\\bdata=["']([^"']*)["'][^>]*id=["']${elementId}["']`, "i"));
  }
  if (!match) return null;
  try {
    return JSON.parse(unescapeHtml(match[1]));
  } catch (_) {
    return null;
  }
}

function flagsFromClient(info) {
  const src = info && typeof info === "object" ? info : {};
  return {
    identity: boolish(
      src.isIdentityVerified ?? src.is_identity_verified ?? src.isIdentificationVerified ?? src.is_identification
    ),
    ruleCheck: boolish(
      src.isEmployerRuleCheckSucceeded ?? src.is_employer_rule_check_succeeded ?? src.isOrderRuleCheckSucceeded
    ),
    certified: boolish(src.isCertifiedEmployer ?? src.is_employer_certification ?? src.isEmployerCertification),
  };
}

function flagsFromText(text) {
  const blob = String(text || "");
  let identity = null;
  let ruleCheck = null;
  if (/本人確認済み/.test(blob)) identity = true;
  else if (/本人確認未提出/.test(blob)) identity = false;
  if (/発注ルールチェック済み/.test(blob)) ruleCheck = true;
  else if (/発注ルールチェック未回答/.test(blob)) ruleCheck = false;
  return { identity, ruleCheck };
}

function parseCrowdWorksDetail(html) {
  const page = String(html || "");
  const info = parseEmbeddedData(page, "client_detail_information_container") || {};
  const fromJson = flagsFromClient(info);
  const fromText = flagsFromText(page);
  const identity = fromJson.identity ?? fromText.identity;
  const ruleCheck = fromJson.ruleCheck ?? fromText.ruleCheck;
  const h1 = page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 ? stripTags(h1[1]).replace(/\s*[-|｜].*$/, "").trim() : "";
  let details = "";
  const detailAt = page.search(/仕事の詳細/);
  if (detailAt >= 0) {
    const slice = page.slice(detailAt, detailAt + 12000);
    const cell = slice.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    details = stripTags(cell ? cell[1] : slice)
      .replace(/^仕事の詳細\s*/, "")
      .trim();
  }
  const posted = page.match(
    /掲載日[\s\S]{0,280}?(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*[月火水木金土日]曜日)?(?:\s*\d{1,2}:\d{2})?)/
  );
  const postedLabel = posted ? posted[1].replace(/\s+/g, " ").trim() : "";
  const dates = globalThis.JobBiderDates;
  const postedAt = dates ? dates.parseJpDate(postedLabel) : null;
  let achievement = "";
  let completionRate = "";
  if (info.jobOfferAchievementCount != null) achievement = `${info.jobOfferAchievementCount}件`;
  if (info.projectFinishedRate != null && info.projectFinishedRate !== "") {
    completionRate = `${info.projectFinishedRate}%`;
  }
  const name = info.userDisplayName || info.username || "";
  return {
    title,
    details,
    description: details,
    client: name || "—",
    identity,
    ruleCheck,
    certified: fromJson.certified,
    achievement: achievement || "—",
    completionRate: completionRate || "—",
    postedLabel,
    postedAt,
    dueAt: postedAt && dates ? dates.plusOneMonth(postedAt) : null,
    at: new Date().toISOString(),
  };
}

function labeledFromText(text, labels) {
  const blob = String(text || "");
  for (const label of labels) {
    const m = blob.match(new RegExp(`${label}\\s*[:：]?\\s*([^\\n]{1,80})`));
    if (!m || !m[1]) continue;
    let value = m[1].replace(/\s+/g, " ").trim();
    value = value.split(/\s{2,}|(?=予算|掲載|締切|業種|カテゴリ|希望)/)[0].trim();
    if (value && !labels.some((other) => value.startsWith(other))) return value;
  }
  return "";
}

function definitionValue(html, labels) {
  const page = String(html || "");
  for (const label of labels) {
    const re = new RegExp(
      `<(?:dt|th)[^>]*>\\s*${label}\\s*</(?:dt|th)>\\s*<(?:dd|td)[^>]*>([\\s\\S]*?)</(?:dd|td)>`,
      "i"
    );
    const m = page.match(re);
    if (!m) continue;
    const value = stripTags(m[1]).replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return "";
}

function parseLancersDetail(html) {
  const page = String(html || "");
  const text = stripTags(page);
  const h1 = page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 ? stripTags(h1[1]).replace(/\s*[-|｜].*$/, "").trim() : "";
  let details = "";
  for (const heading of ["依頼概要", "仕事の詳細", "募集内容"]) {
    const at = page.search(heading);
    if (at < 0) continue;
    const slice = page.slice(at, at + 14000);
    details = stripTags(slice)
      .replace(new RegExp(`^${heading}\\s*`), "")
      .trim();
    if (details.length > 20) break;
  }
  const clientRaw =
    definitionValue(page, ["依頼主", "クライアント"]) || labeledFromText(text, ["依頼主", "クライアント"]);
  const client =
    clientRaw && clientRaw.length <= 40 && !/業種|予算|ログイン/.test(clientRaw) ? clientRaw : "";
  const budget =
    definitionValue(page, ["提示した予算", "予算", "報酬", "希望金額"]) ||
    labeledFromText(text, ["提示した予算", "予算", "報酬", "希望金額"]);
  const postedLabel =
    definitionValue(page, ["掲載日", "募集開始"]) || labeledFromText(text, ["掲載日", "募集開始"]);
  const deadline =
    definitionValue(page, ["締切", "募集期間", "提案期限"]) ||
    labeledFromText(text, ["締切", "募集期間", "提案期限"]);
  const dates = globalThis.JobBiderDates;
  const postedAt = dates && postedLabel ? dates.parseJpDate(postedLabel) : null;
  return {
    title,
    details,
    description: details,
    client: client || "—",
    budget,
    postedLabel,
    postedAt,
    deadline,
    dueAt: postedAt && dates ? dates.plusOneMonth(postedAt) : null,
    at: new Date().toISOString(),
  };
}

function parseLancersLoggedInUser(html) {
  const page = String(html || "");
  const patterns = [
    /data-user-name=["']([^"']+)["']/i,
    /class=["'][^"']*(?:c-header__user-name|header-user-name|userName|nickname)[^"']*["'][^>]*>\s*([^<]{1,40})/i,
    /"nickname"\s*:\s*"([^"\\]{1,40})"/i,
    /"display_name"\s*:\s*"([^"\\]{1,40})"/i,
  ];
  for (const re of patterns) {
    const m = page.match(re);
    const name = m && m[1] ? stripTags(m[1]).replace(/さん$/, "").trim() : "";
    if (name && name.length <= 40 && !/login|sign\s*in|会員登録|ログイン|マイページ/i.test(name)) return name;
  }
  return "";
}

function parseLancersLoggedOut(html) {
  const page = String(html || "");
  if (parseLancersLoggedInUser(page)) return false;
  if (/<title>[^<]*(ログイン|ログイン画面)[^<]*<\/title>/i.test(page)) return true;
  const header = page.match(/<header[\s\S]{0,12000}<\/header>/i);
  const blob = header ? header[0] : page.slice(0, 24000);
  if (/マイページ|ログアウト/.test(blob)) return false;
  const hasLogin = />\s*ログイン\s*</.test(blob) || /href=["'][^"']*\/(user\/)?login[^"']*["']/i.test(blob);
  const hasSignup = /会員登録/.test(blob);
  return hasLogin && hasSignup;
}

self.parseListingJobs = parseListingJobs;
self.parseCrowdWorksDetail = parseCrowdWorksDetail;
self.parseLancersDetail = parseLancersDetail;
self.parseLancersLoggedInUser = parseLancersLoggedInUser;
self.parseLancersLoggedOut = parseLancersLoggedOut;
self.parseLoggedInUser = parseLoggedInUser;

function parseLoggedInUser(html) {
  const page = String(html || "");
  const patterns = [
    /class=["'][^"']*_username_[^"']*["'][^>]*>\s*([^<]{1,40})/i,
    /class=["'][^"']*_normanHeaderUserMenu_[^"']*["'][\s\S]{0,400}?class=["'][^"']*_username_[^"']*["'][^>]*>\s*([^<]{1,40})/i,
    /"current_user"\s*:\s*\{[^{}]{0,800}?"(?:display_name|username|name)"\s*:\s*"([^"\\]+)"/i,
    /"currentUser"\s*:\s*\{[^{}]{0,800}?"(?:displayName|display_name|username|name)"\s*:\s*"([^"\\]+)"/i,
    /gon\.current_user\s*=\s*\{[^{}]{0,800}?"(?:display_name|username|name)"\s*:\s*"([^"\\]+)"/i,
    /data-current-user-name=["']([^"']+)["']/i,
    /id=["']header-username["'][^>]*>\s*([^<]+)/i,
  ];
  for (const re of patterns) {
    const m = page.match(re);
    const name = m && m[1] ? m[1].replace(/\\u0026/g, "&").replace(/さん$/, "").trim() : "";
    if (name && name.length <= 40 && !/login|sign\s*in|会員登録|ログイン/i.test(name)) return name;
  }
  return "";
}
