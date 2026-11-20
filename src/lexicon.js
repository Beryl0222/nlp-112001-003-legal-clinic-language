// Auditable vocabulary for the synthetic intake materials. Nothing here is a
// legal rule; the tables only decide which matter a clause talks about and
// which clarification cues it carries.

export const TOPIC_WEIGHTS = {
  wage: [
    ['工钱', 4], ['工资', 4], ['薪水', 4], ['劳务费', 4], ['wage', 4],
    ['salary', 4], ['pay', 3], ['unpaid', 3], ['owed', 3], ['employer', 3],
    ['做工', 3], ['打工', 3], ['干活', 3], ['工地', 3], ['厂里', 3],
    ['雇主', 3], ['工友', 3],
    ['欠', 2], ['拖', 2], ['没拿到', 2], ['未拿到', 2], ['没收到', 2],
    ['钱', 2], ['上月', 1], ['本月', 1], ['last month', 1], ['this month', 1]
  ],
  land: [
    ['租地', 4], ['租房', 4], ['租赁', 4], ['lease', 4], ['合作社', 4],
    ['cooperative', 4], ['land', 4], ['sign', 2], ['签', 2],
    ['协议', 2], ['合同', 2], ['副本', 2], ['copy', 2], ['一份', 2],
    ['转话', 3], ['转达', 3], ['转告', 3], ['passed', 2],
    ['租', 2], ['地', 1], ['舅', 1], ['叔', 1], ['uncle', 1]
  ]
};

export const TOPIC_LABELS = {
  wage: '工资',
  land: '土地',
  none: '未归入事项',
  mixed: '同句涉及多项'
};

const RELATION_WORDS = '表妹|表姐|表兄|表哥|堂妹|堂姐|堂兄|堂哥|妹妹|姐姐|哥哥|弟弟';
const KIN_WORDS = '舅|叔|姨|姑|伯|婶|哥|姐|妹|弟|侄|甥';
const STOP_CHARS = /^[的地事在是了些和与及或就都也还这那]/u;

export const PATTERNS = {
  hypothetical: /譬如|比如|假如|如果|要是|假设|即使|倘若|suppose|what if|\bif\b/iu,
  correction: /讲错了|说错了|更正|纠正|不是|其实|只是|仅仅|\bno[,.]|\bactually\b|\bonly\b/u,
  pointsBack: /(?:^|[，。；;：:])\s*(?:前面|刚才|早先|先前|上回|之前)/u,
  // Hearsay is a statement about what someone else said. A bare "转话"
  // describes the relative's role in the visitor's own account, so it is not
  // hearsay on its own.
  reported: /听说|据说|听[^，。；]{0,6}说|(?:她|他|他们|人家|阿兰|合作社)[^，。；]{0,6}(?:说|讲|告诉|转述)|\bsays?\b|\bsaid\b|\btold me\b|according to|\bpassed the request\b/iu,
  representation: /(?:替|帮|代)\s*([一-龥A-Za-z]{1,8}?)(?:问|咨询|说明)|on behalf of ([^.,;]{1,20})/iu,
  negation: /没|未|不|别|无|\bnot\b|\bdidn't\b|\bdid not\b|\bno\b/iu,
  firstPerson: /我|咱|本人|\bI\b|\bmy\b|\bme\b/u,
  absence: /不在场|没在场|未在场|不在签|not present|wasn't there|was not there/iu,
  secondhand: /告诉我|跟我说|听[^，。；]{0,8}说|转述|says|said|told me|according to/iu,
  ownMatter: /我自己的|我本人的|是我自己|自己的事|跟[^，。；]{0,6}没关系|my own/iu,
  escort: /我陪|陪同|我跟着|陪[^，。；]{0,6}去|went with/iu,
  month: /上月|本月|这个月|上个?月|last month|this month|几月|\d+\s*月/iu,
  signing: /签|\bsign(?:ed|s|ing)?\b/iu,
  money: /工钱|工资|薪水|劳务费|欠|拖|元|块|wage|salary|pay|owed|unpaid/iu,
  amount: /元|块|金额|多少|\d/iu,
  employer: /老板|雇主|工头|单位|东家|employer/iu,
  counterparty: /合作社|cooperative|公司|单位|村委/iu,
  copy: /副本|一份|copy/iu
};

export function scoreClause(text) {
  let wage = 0;
  let land = 0;
  const wageHits = [];
  const landHits = [];
  for (const [term, weight] of TOPIC_WEIGHTS.wage) {
    if (text.includes(term)) {
      wage += weight;
      wageHits.push(term);
    }
  }
  for (const [term, weight] of TOPIC_WEIGHTS.land) {
    if (text.includes(term)) {
      land += weight;
      landHits.push(term);
    }
  }
  return { wage, land, wageHits, landHits };
}

/**
 * A clause is assigned to a matter only when its own words support that
 * matter. A tie is returned as "mixed" so that it is split by hand instead of
 * guessed. Clauses with no support stay "none"; context is attached later and
 * is never forwarded as evidence.
 */
export function classifyTopic(text) {
  const { wage, land, wageHits, landHits } = scoreClause(text);
  const hits = { wage: wageHits, land: landHits };
  if (wage >= 2 && land >= 2) return { topic: 'mixed', explicit: true, score: { wage, land }, hits };
  if (wage >= 2) return { topic: 'wage', explicit: true, score: { wage, land }, hits };
  if (land >= 2) return { topic: 'land', explicit: true, score: { wage, land }, hits };
  return { topic: 'none', explicit: false, score: { wage, land }, hits };
}

export function topicLabel(topic) {
  return TOPIC_LABELS[topic] || topic;
}

const ORGANISATION = /(合作社|公司|村委|厂|学校|医院)/gu;
const GENERIC_PREFIX = /[的是让叫和与对给向把被从在为这那其个些一二三四五六七八九十]/u;

/**
 * A counterparty is "named" only when an organisation word is preceded by a
 * proper-name-like prefix. "合作社的人" and "合作社的名称" are still unnamed
 * and must be asked about, not treated as an identified party.
 */
export function hasNamedCounterparty(text) {
  for (const match of text.matchAll(ORGANISATION)) {
    const before = text.slice(Math.max(0, match.index - 4), match.index);
    const name = before.match(/[一-龥A-Za-z]{2,4}$/u);
    if (!name) continue;
    if (name[0].split('').some(char => GENERIC_PREFIX.test(char))) continue;
    return true;
  }
  if (/(?:合作社|公司|村委)(?:名叫|叫|名称是)\s*[一-龥A-Za-z]{2,}/u.test(text)) return true;
  return false;
}

export function representationCue(text) {
  const match = PATTERNS.representation.exec(text);
  if (!match) return null;
  return {
    person: match[1] || match[2] || null,
    negated: /不是|并非|\bnot\b/iu.test(text)
  };
}

export function kinshipReferences(text) {
  const refs = [];
  const seen = new Set();
  const add = ref => {
    const key = `${ref.term}|${ref.referent || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const match of text.matchAll(new RegExp(`([一-龥A-Za-z]{1,8})的(${KIN_WORDS})`, 'gu'))) {
    add({ term: match[0], relation: match[2], referent: match[1], named: true });
  }
  for (const match of text.matchAll(new RegExp(`(她|他|其)(${KIN_WORDS})`, 'gu'))) {
    add({ term: match[0], relation: match[2], referent: null, pronoun: match[1], named: false });
  }
  for (const match of text.matchAll(new RegExp(`我(?:的)?(${KIN_WORDS})`, 'gu'))) {
    add({ term: match[0], relation: match[1], referent: '说话人', named: true });
  }
  for (const match of text.matchAll(/\b(her|his|their)\s+(uncle|aunt|cousin|brother|sister)\b/giu)) {
    add({
      term: match[0],
      relation: match[2].toLowerCase(),
      referent: null,
      pronoun: match[1].toLowerCase(),
      named: false
    });
  }
  return refs;
}

export function identityCues(text) {
  const cues = { relation: null, uncleOfVisitor: null };
  const relation = new RegExp(`([一-龥A-Za-z]{1,8})是我(?:的)?(${RELATION_WORDS})`).exec(text);
  if (relation) {
    cues.relation = {
      term: relation[0],
      person: relation[1],
      relation: relation[2],
      speaker: '说话人'
    };
  }
  const uncle = new RegExp(`(她|他)(${KIN_WORDS}).{0,6}也是我(?:的)?(${KIN_WORDS})`).exec(text);
  if (uncle) {
    cues.uncleOfVisitor = {
      term: uncle[0],
      pronoun: uncle[1],
      relation: uncle[2],
      visitorRelation: uncle[3]
    };
  }
  return cues;
}

/**
 * Separate the three facts that a bare "签" hides: who was asked, who signed,
 * and who explicitly did not sign. A named subject ("阿兰自己签的") is kept;
 * speakers are recorded as 说话人 rather than a person id.
 */
export function signingCues(text) {
  if (!PATTERNS.signing.test(text)) return null;
  const denied = /(我|本人)[^，。；]{0,4}(没|未|没有)签|我可没签|did not sign|didn't sign|没有签字|未签字/iu.test(text);
  const admittedByName = /(?:^|[，。；])\s*字?是?([一-龥A-Za-z]{1,4})自己签/iu.exec(text);
  const admittedByMe = !denied && /(我|本人)[^，。；]{0,6}签了|我签了|签了字|\bI signed\b/iu.test(text);
  const admitted = !denied && (admittedByMe || Boolean(admittedByName));
  let askedPerson = null;
  let requester = null;
  let asked = false;

  const postposed = /(?:让|叫|要求)([^，。；]{1,6}?)签的?是([^，。；]+)/u.exec(text);
  if (postposed) {
    asked = true;
    askedPerson = postposed[1].trim();
    requester = postposed[2].trim();
  } else {
    const standard = /^([^，。；：]{1,12}?)(?:让|叫|要求)(.*)$/u.exec(text);
    if (standard && /签/u.test(standard[2])) {
      asked = true;
      requester = standard[1].trim();
      const object = /^([^，。；]{1,4}?)签/u.exec(standard[2]);
      askedPerson = object ? object[1].trim() : null;
    }
    const english = /^(.*?)\s+(?:asked|told)\s+(.*?)\s+to\s+sign/iu.exec(text);
    if (english) {
      asked = true;
      requester = english[1].trim();
      askedPerson = english[2].trim();
    }
  }

  return {
    denied,
    admitted,
    admittedByName: admittedByName ? admittedByName[1] : null,
    admittingSpeaker: admittedByMe,
    asked,
    requester,
    askedPerson
  };
}

const KNOWN_PLACES = ['柘坪村', '柘坪', '青涧', '锦城'];

function cleanPlace(name) {
  let value = name;
  while (value.length > 2 && STOP_CHARS.test(value)) value = value.slice(1);
  return value;
}

/**
 * A place mentioned inside a statement is not automatically the place of the
 * event: "是在青涧" may be where the visit or referral happened. The cue keeps
 * the phrase so that the report can ask which reading applies.
 */
export function placeCues(text) {
  const names = new Set();
  for (const place of KNOWN_PLACES) {
    if (text.includes(place)) names.add(place);
  }
  for (const match of text.matchAll(/([一-龥]{1,4}(?:村|镇|乡|县|市|区))/gu)) {
    const raw = match[1];
    const named = KNOWN_PLACES.find(place => raw.endsWith(place)) ||
      raw.replace(/^[一-龥]{0,2}(?=[一-龥]{2}(?:村|镇|乡|县|市|区))/u, '');
    if (named && !STOP_CHARS.test(named)) names.add(cleanPlace(named));
  }
  if (names.size === 0) return null;
  const unique = [...names].filter(name => ![...names].some(other => other !== name && other.includes(name)));
  const phrase = /在([^，。；]{1,12})/u.exec(text);
  return {
    names: unique,
    phrase: phrase ? phrase[0] : null,
    eventWord: /(?:发生|签|租|做工|干活|工地|合作社|办公室|村东|村西)/u.test(text),
    ambiguous: Boolean(phrase) && !/(?:村|镇|乡|工地|办公室|合作社|发生)/u.test(text)
  };
}

export function normalizeParty(label) {
  if (!label) return null;
  const value = label.trim();
  if (/合作社|cooperative/iu.test(value)) return '合作社的人';
  if (/舅|uncle/iu.test(value)) return '她舅';
  if (/^Lan$/iu.test(value)) return '阿兰';
  return value;
}

/**
 * Pronouns in a "asked ... to sign" phrase carry no identity. Keep the
 * pronoun visible so the report asks instead of assuming.
 */
export function normalizeSigner(label) {
  if (!label) return null;
  const value = label.trim();
  if (/^(她|他|其)$/u.test(value)) return `${value}（所指待确认）`;
  if (/^(the cooperative|cooperative)$/iu.test(value)) return '合作社的人';
  return value;
}
