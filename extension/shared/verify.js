function clientMark(ok, passLabel, failLabel) {
  if (ok === true) return `✓ ${passLabel}`;
  if (ok === false) return `✗ ${failLabel}`;
  return `— ${passLabel}`;
}

function clientMarks(extract) {
  return {
    identity: clientMark(extract?.identity, "本人確認", "本人確認未提出"),
    rule: clientMark(extract?.ruleCheck, "発注ルール", "発注ルールチェック未回答"),
  };
}

globalThis.JobBiderVerify = { clientMark, clientMarks };
