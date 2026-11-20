import { splitClauses, splitSentences, compact } from './text.js';
import { alignSentences } from './align.js';
import {
  classifyTopic,
  hasNamedCounterparty,
  identityCues,
  kinshipReferences,
  normalizeParty,
  normalizeSigner,
  placeCues,
  representationCue,
  signingCues,
  topicLabel,
  PATTERNS
} from './lexicon.js';

export const DISCLAIMER = '本工具只整理来访者原话、翻译补记与分流选项，不构成法律意见，也不代替接访人员的判断。';

export const PHASES = [
  { id: 'opening', label: '开场与身份', note: '先分清谁亲历、谁代问，再进入事项。' },
  { id: 'matters', label: '事项分流', note: '每句话只归入它能支持的事项，不替来访者补全事实。' },
  { id: 'correction', label: '更正与补记', note: '原始说法和更正并存，更正只改它指向的事项。' },
  { id: 'handover', label: '交接复核', note: '只看接收方可见范围内的内容，并留下更正依据。' }
];

export const STATION_ORDER = ['s3', 's1', 's2'];

const MAIN_STATION_TOPICS = {
  s1: ['land'],
  s2: ['wage'],
  s3: ['translation']
};

const SUPPORT_STATIONS = new Set(['s4', 's5', 's6', 's7', 's8']);

export const ROLE_LABELS = {
  representative: '代问',
  subject: '当事人',
  possiblySubject: '可能是当事人',
  askedToSign: '被要求签字',
  signed: '实际签字',
  didNotSign: '明确未签',
  accompanied: '陪同到场'
};

export function listOf(value) {
  return String(value || '')
    .split(/[、,，;；/|]+/u)
    .map(part => part.trim())
    .filter(Boolean);
}

export function stationScope(station) {
  const configured = MAIN_STATION_TOPICS[station.id];
  if (configured) {
    return {
      topics: configured,
      exactTurnsOnly: station.id === 's3',
      summaryOnly: false,
      reason: station.access
    };
  }
  if (SUPPORT_STATIONS.has(station.id)) {
    return { topics: [], exactTurnsOnly: true, summaryOnly: true, reason: station.access };
  }
  const topics = [];
  if (/土地|租/.test(station.access || '')) topics.push('land');
  if (/工资|务工|欠薪/.test(station.access || '')) topics.push('wage');
  return {
    topics,
    exactTurnsOnly: /只发|选段/.test(station.access || ''),
    summaryOnly: false,
    reason: station.access
  };
}

function clauseCues(text) {
  const value = compact(text);
  return {
    hypothetical: PATTERNS.hypothetical.test(value),
    correction: PATTERNS.correction.test(value),
    pointsBack: PATTERNS.pointsBack.test(value) && PATTERNS.correction.test(value),
    reported: PATTERNS.reported.test(value),
    representation: representationCue(value),
    negated: PATTERNS.negation.test(value),
    firstPerson: PATTERNS.firstPerson.test(value),
    absence: PATTERNS.absence.test(value),
    secondhand: PATTERNS.secondhand.test(value),
    ownMatter: PATTERNS.ownMatter.test(value),
    escort: PATTERNS.escort.test(value),
    signing: signingCues(value),
    place: placeCues(value),
    kinship: kinshipReferences(value),
    identity: identityCues(value)
  };
}

function parseClauses(text) {
  return splitClauses(text).map((part, index) => ({
    index,
    text: part.text,
    start: part.start,
    end: part.end,
    ...classifyTopic(part.text),
    ...clauseCues(part.text)
  }));
}

export function buildWorkspace(inputs) {
  const people = (inputs['人员登记.json'] || []).map(person => ({
    ...person,
    aliasList: listOf(person.aliases)
  }));
  const personByLabel = new Map();
  for (const person of people) {
    for (const label of [person.display, ...person.aliasList]) {
      if (!personByLabel.has(label)) personByLabel.set(label, person);
    }
  }

  const turns = (inputs['访谈.json'] || []).map((row, index) => ({
    row,
    index,
    kind: 'interview',
    id: row.id,
    turn: row.turn,
    voice: row.voice,
    language: row.language,
    heardAt: row.heardAt,
    text: row.text,
    worker: row.voice === '接访员' || row.voice === '译员',
    clauses: parseClauses(row.text)
  }));

  const supplements = (inputs['补充.json'] || []).map((row, index) => ({
    row,
    index,
    kind: 'supplement',
    id: row.id,
    recordedAt: row.recordedAt,
    voice: row.voice,
    language: row.language,
    heardAt: row.heardAt,
    text: row.text,
    worker: false,
    clauses: parseClauses(row.text)
  }));

  const referrals = (inputs['转介.json'] || []).map((row, index) => ({
    row,
    index,
    id: row.id,
    item: row.item,
    toStation: row.toStation,
    sentAt: row.sentAt,
    status: row.status,
    basisTurns: listOf(row.basisTurns),
    excerptTurns: listOf(row.excerptTurns),
    arrangement: row.arrangement || '',
    note: row.note || ''
  }));

  const stations = inputs['服务站.json'] || [];
  const stationById = new Map(stations.map(station => [station.id, station]));
  const turnById = new Map(turns.map(entry => [entry.id, entry]));
  const recordById = new Map([...turns, ...supplements].map(entry => [entry.id, entry]));

  return {
    inputs,
    people,
    personByLabel,
    turns,
    turnById,
    recordById,
    supplements,
    referrals,
    stations,
    stationById,
    glossary: (inputs['词表.json'] || []).map(entry => ({ ...entry }))
  };
}

function markersOf(item) {
  const markers = [];
  if (item.hypothetical) markers.push('假设/举例');
  if (item.pointsBack) markers.push('指向此前说法');
  else if (item.correction) markers.push('更正/限定');
  if (item.reported) markers.push('转述');
  if (item.representation) markers.push('代问');
  if (item.absence) markers.push('不在场');
  if (item.secondhand) markers.push('听他人转述');
  if (item.ownMatter) markers.push('本人事项');
  if (item.escort) markers.push('陪同');
  if (item.signing) markers.push('签字');
  if (item.kinship.length) markers.push('亲属称谓');
  if (item.identity.relation || item.identity.uncleOfVisitor) markers.push('身份关系补充');
  if (item.place) markers.push('地点');
  return markers;
}

function itemOf(entry, clause) {
  const item = {
    kind: entry.kind,
    sourceId: entry.id,
    turnId: entry.id,
    turn: entry.turn || entry.recordedAt,
    language: entry.language,
    voice: entry.voice,
    heardAt: entry.heardAt,
    worker: entry.worker,
    clauseIndex: clause.index,
    text: clause.text,
    start: clause.start,
    end: clause.end,
    topic: clause.topic,
    ...clause
  };
  return { ...item, markers: markersOf(item) };
}

function emptyBucket() {
  return { statements: [], reported: [], questions: [] };
}

function ids(items) {
  return [...new Set(items.map(item => item.sourceId))];
}

function hasText(items, pattern) {
  return items.some(item => pattern.test(item.text));
}

function correctionTarget(item) {
  return item.topic === 'land' || item.topic === 'wage' ? item.topic : null;
}

export function buildClarification(state, { includeSupplements = true } = {}) {
  const buckets = {
    land: emptyBucket(),
    wage: emptyBucket(),
    unassigned: emptyBucket(),
    withheld: emptyBucket()
  };
  const corrections = [];
  const pending = [];
  const speakers = [];
  const additions = [];
  const seenSpeakers = new Map();

  const sources = includeSupplements
    ? [...state.turns, ...state.supplements]
    : [...state.turns];

  for (const entry of sources) {
    if (entry.kind === 'supplement') additions.push(entry);
    if (!seenSpeakers.has(entry.voice)) {
      seenSpeakers.set(entry.voice, {
        voice: entry.voice,
        turnIds: [],
        supplementIds: [],
        worker: entry.worker
      });
      speakers.push(seenSpeakers.get(entry.voice));
    }
    const speaker = seenSpeakers.get(entry.voice);
    if (entry.kind === 'interview') speaker.turnIds.push(entry.id);
    else speaker.supplementIds.push(entry.id);

    for (const clause of entry.clauses) {
      const item = itemOf(entry, clause);
      if (entry.worker) {
        // An example posed by the interviewer is still only a prompt: it goes
        // to follow-up questions, never to the facts.
        if (item.hypothetical) {
          pending.push({
            ...item,
            reason: `${entry.voice}只是在举例，不是当事人陈述；须确认来访者本人是否经历过。`,
            ask: '这是举例，还是您自己遇到的情况？'
          });
        } else {
          buckets.withheld.statements.push({
            ...item,
            note: `${entry.voice}的话属于追问或翻译补记，不是当事人陈述，不能作为证据转出。`
          });
        }
        continue;
      }
      if (item.hypothetical) {
        pending.push({
          ...item,
          reason: '这是假设或举例，需要确认当事人是否亲身经历。',
          ask: '这是举例，还是您自己遇到的情况？'
        });
        continue;
      }
      if (item.pointsBack) {
        corrections.push({
          ...item,
          target: correctionTarget(item),
          pointsBack: true,
          scopeNote: '这句话指向此前说法，但本身没有写明事项；须由来访者指认它改的是哪件事。'
        });
        continue;
      }
      if (item.correction) {
        corrections.push({
          ...item,
          target: correctionTarget(item),
          pointsBack: false,
          scopeNote: '更正只改它指向的事项和字段，不连带改写另一事项。'
        });
      }
      if (item.topic === 'none') {
        buckets.unassigned.statements.push(item);
        continue;
      }
      if (item.topic === 'mixed') {
        buckets.unassigned.statements.push({
          ...item,
          note: '同一分句同时带两项事项的线索，须逐项拆问后再归入。'
        });
        continue;
      }
      buckets[item.topic].statements.push(item);
      if (item.reported) buckets[item.topic].reported.push(item);
    }
  }

  buckets.land.questions = landQuestions(buckets, corrections, additions);
  buckets.wage.questions = wageQuestions(buckets, corrections, additions);

  return {
    buckets,
    corrections,
    pending,
    speakers,
    additions,
    roles: buildRoles(buckets, additions),
    questions: [...buckets.land.questions, ...buckets.wage.questions]
  };
}

function representationByTurn(buckets) {
  return new Map(buckets.unassigned.statements
    .filter(item => item.representation && !item.representation.negated)
    .map(item => [item.sourceId, item]));
}

/**
 * Roles are recorded per matter. The same visitor can speak for someone else
 * about the lease and about their own wages in the same visit; a correction in
 * one matter never moves a role or a statement into the other.
 */
function buildRoles(buckets, additions) {
  const land = [];
  const wage = [];
  const representative = representationByTurn(buckets);
  const added = additions.flatMap(entry => entry.clauses.map(clause => ({
    ...clause,
    sourceId: entry.id,
    voice: entry.voice
  })));

  for (const [turnId, item] of representative) {
    for (const topic of ['land', 'wage']) {
      const statements = buckets[topic].statements.filter(statement => statement.sourceId === turnId);
      if (!statements.length) continue;
      const target = topic === 'land' ? land : wage;
      target.push({
        role: 'representative',
        person: item.voice,
        for: item.representation.person,
        topic,
        basis: [turnId],
        text: item.text,
        status: '来访者自述'
      });
    }
  }

  const landFacts = signingFacts([...buckets.land.statements, ...added.filter(clause => clause.topic === 'land')]);
  for (const person of landFacts.asked) {
    land.push({
      role: 'askedToSign',
      person,
      topic: 'land',
      basis: ids([...buckets.land.statements, ...added].filter(item => item.signing && item.signing.asked)),
      status: '待确认'
    });
  }
  for (const person of landFacts.admitted) {
    land.push({
      role: 'signed',
      person,
      topic: 'land',
      basis: ids([...buckets.land.statements, ...added].filter(item => item.signing && item.signing.admitted)),
      status: '来访者自述'
    });
  }
  for (const person of landFacts.deniedBy) {
    land.push({
      role: 'didNotSign',
      person,
      topic: 'land',
      basis: ids(buckets.land.statements.filter(item => item.signing && item.signing.denied)),
      status: '来访者自述'
    });
  }
  for (const item of buckets.land.statements.filter(entry => entry.escort)) {
    land.push({
      role: 'accompanied',
      person: item.voice,
      topic: 'land',
      basis: [item.sourceId],
      status: '来访者自述'
    });
  }

  for (const item of buckets.wage.statements) {
    if (item.ownMatter) {
      wage.push({ role: 'subject', person: item.voice, topic: 'wage', basis: [item.sourceId], status: '来访者自述' });
    } else if (item.firstPerson && PATTERNS.money.test(item.text)) {
      wage.push({ role: 'possiblySubject', person: item.voice, topic: 'wage', basis: [item.sourceId], status: '待确认是否为本人' });
    }
  }
  for (const item of added.filter(clause => clause.topic === 'wage' && clause.ownMatter)) {
    wage.push({ role: 'subject', person: item.voice, topic: 'wage', basis: [item.sourceId], status: '来访者自述' });
  }

  return { land: dedupeRoles(land), wage: dedupeRoles(wage) };
}

function dedupeRoles(roles) {
  const seen = new Set();
  const unique = roles.filter(role => {
    const key = `${role.role}|${role.person}|${role.for || ''}|${role.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Once the visitor has confirmed a matter as their own, the earlier
  // "possibly the subject" note is folded into that role, but its basis stays
  // visible so the earlier statement can still be traced.
  const confirmed = new Map(unique
    .filter(role => role.role === 'subject')
    .map(role => [role.person, role]));
  const folded = unique.filter(role => {
    if (role.role !== 'possiblySubject' || !confirmed.has(role.person)) return true;
    const subject = confirmed.get(role.person);
    subject.basis = [...new Set([...role.basis, ...subject.basis])];
    subject.priorBasis = role.basis;
    return false;
  });
  return folded;
}

function signingFacts(items) {
  const facts = { asked: [], requester: [], deniedBy: [], admitted: [], escort: [] };
  for (const item of items) {
    if (item.signing) {
      if (item.signing.asked && item.signing.askedPerson) facts.asked.push(normalizeSigner(item.signing.askedPerson));
      if (item.signing.requester) facts.requester.push(normalizeParty(item.signing.requester));
      if (item.signing.denied) facts.deniedBy.push(item.voice);
      if (item.signing.admitted) {
        facts.admitted.push(item.signing.admittedByName || (item.signing.admittingSpeaker ? item.voice : '未具名'));
      }
    }
    if (item.escort) facts.escort.push(item.sourceId);
  }
  for (const key of Object.keys(facts)) facts[key] = [...new Set(facts[key])];
  return facts;
}

function landQuestions(buckets, corrections, additions) {
  const items = buckets.land.statements;
  const added = additions.flatMap(entry => entry.clauses
    .filter(clause => clause.topic === 'land' || clause.identity.relation || clause.identity.uncleOfVisitor)
    .map(clause => ({ ...clause, sourceId: entry.id, voice: entry.voice })));
  const questions = [];
  const facts = signingFacts([...items, ...added]);

  if (facts.asked.length || facts.deniedBy.length || facts.admitted.length) {
    const parts = [];
    if (facts.asked.length) parts.push(`被要求签的是${facts.asked.join('／')}`);
    if (facts.admitted.length) parts.push(`${facts.admitted.join('／')}自己签了`);
    if (facts.deniedBy.length) parts.push(`${facts.deniedBy.join('／')}说自己没签`);
    questions.push({
      id: 'land-signing-roles',
      ask: `现有说法是：${parts.join('；')}。请确认这是同一份租地文件吗？`,
      basis: ids([...items.filter(item => item.signing), ...added.filter(item => item.signing)]),
      facts,
      separates: '“被要求签”“实际签了”“没有签”分属不同的人，不能并成一句。'
    });
  } else {
    questions.push({
      id: 'land-signing-roles',
      ask: '租地文件是谁被要求签、谁实际签了？',
      basis: [],
      separates: '需要把要求方、签字人和在场人分开记录。'
    });
  }

  const requesterItems = items.filter(item => item.signing && item.signing.requester);
  if (facts.requester.length > 1) {
    questions.push({
      id: 'land-requester-change',
      ask: `要求方从${facts.requester[0]}变成${facts.requester.slice(1).join('、')}。哪一次说法为准，变化是怎么知道的？`,
      basis: ids(requesterItems),
      separates: '原说法与更正并列保留；确认前不能把更正当成唯一事实。'
    });
  } else if (facts.requester.length === 1) {
    questions.push({
      id: 'land-requester',
      ask: `“${facts.requester[0]}”是文件的哪一方？是本人要求，还是替别人传话？`,
      basis: ids(requesterItems),
      separates: '传话的人不等于要求方。'
    });
  }

  const placeItems = [...items, ...added].filter(item => item.place);
  const ambiguous = placeItems.filter(item => item.place.ambiguous);
  if (placeItems.length === 0) {
    questions.push({
      id: 'land-place',
      ask: '租地发生在哪个村、哪块地？',
      basis: '记录中没有土地所在地',
      separates: 'heardAt 只是录入站，不能当作事件发生地。'
    });
  } else if (ambiguous.length) {
    questions.push({
      id: 'land-place-kind',
      ask: `“${ambiguous[0].place.phrase}”是说事情发生在那里，还是只是去那里办理或转介？`,
      basis: ids(ambiguous),
      separates: '事件发生地、办理地和转介地要分开记。'
    });
  } else {
    const names = [...new Set(placeItems.flatMap(item => item.place.names))];
    questions.push({
      id: 'land-place',
      ask: `租地在${names.join('／')}的具体位置能否再说明（门牌、地块或四至）？`,
      basis: ids(placeItems),
      separates: '地点已由来访者说明，但仍需具体到可核对的位置。'
    });
  }

  const wagePlace = [...items, ...added].find(item => item.place && item.topic === 'wage');
  if (wagePlace) {
    questions.push({
      id: 'land-place-cross',
      ask: `“${wagePlace.place.phrase}”出现在工钱那句里，不能拿来判断租地地点，对吗？`,
      basis: [wagePlace.sourceId],
      separates: '一件事的地点不能自动搬到另一件事上。'
    });
  }

  const kinship = [...items, ...added].flatMap(item => item.kinship.map(ref => ({ ref, item })));
  const unnamed = kinship.filter(entry => !entry.ref.named);
  if (unnamed.length) {
    questions.push({
      id: 'land-kinship',
      ask: `“${unnamed[0].ref.term}”中的“${unnamed[0].ref.pronoun || '她'}”指谁？这位亲属与阿兰、与来访人各是什么关系？`,
      basis: ids(unnamed.map(entry => entry.item)),
      status: '待确认关系',
      separates: '称谓所指不明时只能标为关系待确认，不能认定是哪一位亲属。'
    });
  }
  const namedRelations = added.flatMap(item => (item.identity
    ? [item.identity.relation, item.identity.uncleOfVisitor].filter(Boolean).map(value => ({ value, item }))
    : []));
  if (namedRelations.length) {
    questions.push({
      id: 'land-identity',
      ask: `补充说“${namedRelations[0].value.term}”。这是来访者自己的说法，是否还有其他亲属或材料可以印证？`,
      basis: ids(namedRelations.map(entry => entry.item)),
      status: '已补充，未经核实',
      separates: '补充说明是来访者的陈述，不等于已经核实的关系。'
    });
  }

  const counterparty = [...items, ...added].filter(item => PATTERNS.counterparty.test(item.text));
  if (counterparty.length) {
    questions.push({
      id: 'land-counterparty',
      ask: '合作社的名称、经办人是谁？要求签字的是哪位？',
      basis: ids(counterparty),
      separates: '更正后的相对方要和原说法并列保留。'
    });
  } else {
    questions.push({
      id: 'land-counterparty',
      ask: '租地文件的另一方是谁？是个人、合作社还是村委？',
      basis: '记录中没有相对方名称'
    });
  }

  if (hasText(items, PATTERNS.copy)) {
    questions.push({
      id: 'land-copy',
      ask: '文件有没有留副本或照片？原件在谁手里？',
      basis: ids(items.filter(item => PATTERNS.copy.test(item.text))),
      separates: '“没给她留一份”是缺副本，不等于没签字。'
    });
  }

  const loose = corrections.filter(item => !item.target);
  if (loose.length) {
    questions.push({
      id: 'land-correction-scope',
      ask: '“前面我讲错了”具体改的是哪一句：是谁要求签、谁签了，还是地点？',
      basis: ids(loose),
      separates: '指向不明的更正不能自动套到整件事上。'
    });
  }

  return questions;
}

function wageQuestions(buckets, corrections, additions) {
  const items = buckets.wage.statements;
  const added = additions.flatMap(entry => entry.clauses
    .filter(clause => clause.topic === 'wage')
    .map(clause => ({ ...clause, sourceId: entry.id, voice: entry.voice })));
  const all = [...items, ...added];
  const questions = [];

  const selfMatter = all.filter(item => item.ownMatter);
  const representation = items.filter(item => item.representation && !item.representation.negated);
  if (selfMatter.length) {
    questions.push({
      id: 'wage-who',
      ask: '补充说明称工钱是本人的事、与阿兰无关。之前“替阿兰问”只指租地，对吗？',
      basis: ids([...selfMatter, ...representation]),
      separates: '同一人在这件事里是当事人，在另一件事里是代问者，两个角色不能互换。'
    });
  } else if (representation.length) {
    questions.push({
      id: 'wage-who',
      ask: '工钱的事是谁的？是您本人没拿到，还是替阿兰问的？',
      basis: ids(representation),
      separates: '代问者与欠薪当事人不是同一个角色。'
    });
  } else {
    questions.push({
      id: 'wage-who',
      ask: '这笔工钱是谁的，谁在讨？',
      basis: [],
      separates: '先确认主体，再谈金额和雇主。'
    });
  }

  const place = all.find(item => item.place);
  if (!place) {
    questions.push({
      id: 'wage-place',
      ask: '欠薪发生在哪个工地或单位？是否在青涧？',
      basis: '工资分句没有发生地'
    });
  } else {
    questions.push({
      id: 'wage-place',
      ask: `工钱的事发生在${place.place.names.join('／')}的哪个工地？这是做工地点，还是到站办理的地点？`,
      basis: [place.sourceId],
      separates: '“在青涧”要说明是做工的地点，还是到站办理的地点。'
    });
  }

  if (!hasText(all, PATTERNS.amount)) {
    questions.push({
      id: 'wage-amount',
      ask: '欠付金额是多少，怎么算出来的？',
      basis: '工资分句没有金额'
    });
  }
  if (!hasText(all, PATTERNS.employer)) {
    questions.push({
      id: 'wage-employer',
      ask: '雇主或工头是谁？有没有考勤、转账记录或工友可以作证？',
      basis: '工资分句没有雇主信息'
    });
  }
  const months = items.filter(item => PATTERNS.month.test(item.text));
  questions.push({
    id: 'wage-month',
    ask: months.length ? '“上月”具体是哪个月，约定哪天发薪？' : '欠的是哪个月到哪个月的工钱？',
    basis: months.length ? ids(months) : '工资分句没有可核对的时间',
    separates: '相对时间要落成具体月份。'
  });

  if (corrections.length) {
    questions.push({
      id: 'wage-correction',
      ask: '上面的更正是只改租地那件事，还是也改工钱的说法？',
      basis: ids(corrections),
      separates: '一项更正不能自动影响另一项。'
    });
  }
  return questions;
}

function signerKnown(items) {
  return items.some(item => item.signing && item.signing.admitted);
}

function placeKnown(items) {
  return items.some(item => item.place && !item.place.ambiguous);
}

function missingFor(topic, statements, added, corrections) {
  const all = [...statements, ...added];
  const missing = [];
  if (topic === 'land') {
    if (!placeKnown(all)) missing.push('土地所在地未见说明');
    if (!signerKnown(all)) missing.push('“谁实际签了”尚待确认');
    if (!all.some(item => hasNamedCounterparty(item.text))) missing.push('相对方名称未见说明');
    if (corrections.some(item => !item.target)) {
      missing.push('有一处更正未写明改的是哪件事，须先指认');
    }
    if (corrections.some(item => item.target === 'land')) {
      missing.push('相对方说法有更正，须与原说法并列确认');
    }
    const unnamed = statements.flatMap(item => item.kinship).some(ref => !ref.named);
    const identity = added.some(item => item.identity.relation || item.identity.uncleOfVisitor);
    if (unnamed && !identity) missing.push('亲属称谓所指待确认');
  } else {
    if (!all.some(item => item.ownMatter || (item.firstPerson && PATTERNS.money.test(item.text)))) {
      missing.push('无法确认是本人还是代问的工资');
    }
    if (!placeKnown(all)) missing.push('工资发生地未见说明');
    if (!hasText(all, PATTERNS.amount)) missing.push('欠付金额未见说明');
    if (!hasText(all, PATTERNS.employer)) missing.push('雇主或工头未见说明');
  }
  return missing;
}

function summarizeMatter(state, clarification, station, scope, topic) {
  const { buckets, corrections, additions } = clarification;
  const statements = buckets[topic].statements;
  const added = additions.flatMap(entry => entry.clauses
    .filter(clause => clause.topic === topic)
    .map(clause => ({ ...clause, sourceId: entry.id })));
  const missing = missingFor(topic, statements, added, corrections);

  if (!scope.topics.includes(topic)) {
    if (scope.exactTurnsOnly) {
      // The translation desk does not receive either matter as evidence; it
      // receives the translated passages that touch that matter, plus their
      // originals, so the relation stays in the right turn.
      const passages = state.turns
        .filter(entry => entry.language === 'en' &&
          entry.clauses.some(clause => clause.topic === topic))
        .map(entry => entry.id);
      return {
        status: 'translationOnly',
        transferable: passages,
        withheld: [],
        needs: [],
        blocking: [],
        missing: [],
        reason: `${station.name}只处理语言补问，接收译文选段并逐句附回原话，不作为事项证据；能否转介由事项站判断。`
      };
    }
    return {
      status: 'outOfScope',
      transferable: [],
      withheld: [],
      needs: [],
      blocking: [],
      missing: [],
      reason: `${station.name}的能力说明为“${station.access}”，不接收本事项的证据。`
    };
  }

  // The translation desk may receive translated passages; the two substantive
  // stations may receive only first-hand statements by the visitor.
  const evidence = statements.filter(item =>
    (scope.exactTurnsOnly ? item.language === 'en' : true) && !item.reported);
  const transferable = [...new Set(evidence.map(item => item.sourceId))];
  const withheld = statements
    .filter(item => item.reported)
    .map(item => ({
      sourceId: item.sourceId,
      text: item.text,
      reason: '转述或译文只作线索，不作为事实依据转出。'
    }));

  const blocking = missing.filter(item => {
    if (topic === 'land') return /所在地|实际签|指认|并列确认/.test(item);
    return /本人还是代问|发生地/.test(item);
  });
  const needs = missing.filter(item => !blocking.includes(item));

  let status;
  if (missing.length === 0) status = 'eligible';
  else if (transferable.length) status = 'partial';
  else status = 'pending';
  const reason = status === 'eligible'
    ? '现有陈述已能支持本事项的选段转介。'
    : status === 'partial'
      ? '已明确的部分可先转介，其余留在本站补问。'
      : '尚不足以转介，先补问。';

  return { status, transferable, withheld, reason, missing, needs, blocking };
}

export function buildAssessments(state) {
  const assessments = [];
  for (const stationId of STATION_ORDER) {
    const station = state.stationById.get(stationId);
    if (!station) continue;
    const scope = stationScope(station);
    assessments.push({
      stationId,
      station,
      scope,
      matters: {
        land: summarizeMatter(state, state.clarification, station, scope, 'land'),
        wage: summarizeMatter(state, state.clarification, station, scope, 'wage')
      }
    });
  }
  return assessments;
}

function contentScore(zh, en) {
  let score = 0;
  if (/(舅|叔|uncle)/iu.test(zh) && /uncle/iu.test(en)) score += 3;
  if (/(签|signed|sign)/iu.test(zh) && /sign/iu.test(en)) score += 3;
  if (/(合作社|cooperative)/iu.test(zh) && /cooperative/iu.test(en)) score += 3;
  if (/(转话|转达|passed)/iu.test(zh) && /passed/iu.test(en)) score += 2;
  if (/(租地|lease|land)/iu.test(zh) && /(lease|land|it\b)/iu.test(en)) score += 1;
  if (/(工钱|工资|wage|salary)/iu.test(zh) && /(wage|salary|pay|money)/iu.test(en)) score += 3;
  if (/(没签|did not sign|didn't sign)/iu.test(zh) && /(did not sign|didn't sign)/iu.test(en)) score += 2;
  if (/(上月|last month)/iu.test(zh) && /last month/iu.test(en)) score += 2;
  return score;
}

/**
 * Pair translated passages with the utterance they belong to by content, not
 * by neighbouring turn numbers: in the sample, t3 translates t1 while t2 sits
 * between them. Each pair keeps the original and the translation side by side.
 */
export function buildTranslation(state) {
  const enTurns = state.turns.filter(entry => entry.language === 'en');
  const zhTurns = state.turns.filter(entry => entry.language === 'zh');
  const used = new Set();
  const pairs = [];

  for (const enTurn of enTurns) {
    const best = zhTurns
      .filter(zh => !used.has(zh.id))
      .map(zh => ({ zh, score: contentScore(zh.text, enTurn.text) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 2) continue;
    used.add(best.zh.id);
    const zhClauses = splitClauses(best.zh.text);
    const enClauses = splitSentences(enTurn.text);
    const warnings = [];
    if (/\bdid it\b|\bit\b|\bthey\b|\bthem\b/iu.test(enTurn.text)) {
      warnings.push('英文用代词代替了具体动作或标的，需回问所指；不能据此认定谁签了字。');
    }
    if (zhClauses.length !== enClauses.length) {
      warnings.push(`原话 ${zhClauses.length} 个分句、译文 ${enClauses.length} 句，须由译员说明合并或拆分的位置。`);
    }
    const alignment = alignSentences(
      zhClauses.map(part => part.text),
      enClauses.map(part => part.text)
    );
    const orphanSources = zhClauses
      .map((part, index) => ({ part, index }))
      .filter(({ index }) => !alignment.some(row => row.sourceIndex === index && row.aligned));
    const orphanTargets = alignment.filter(row => !row.aligned);
    if (orphanSources.length) {
      warnings.push(`原话分句「${orphanSources.map(item => item.part.text).join('」「')}」在译文中找不到对应句。`);
    }
    if (orphanTargets.length) {
      warnings.push(`译文句「${orphanTargets.map(row => row.targetText).join('」「')}」在原话中找不到对应分句。`);
    }
    const mergedOne = new Map();
    for (const row of alignment) {
      if (!row.aligned) continue;
      mergedOne.set(row.targetIndex, (mergedOne.get(row.targetIndex) || 0) + 1);
    }
    if ([...mergedOne.values()].some(count => count > 1)) {
      warnings.push('一句译文可能同时承载多个分句，关系可能被并到错误的句子里；请译员逐句指回原话。');
    }
    for (const row of alignment) {
      if (row.aligned && row.confidence < 3) {
        warnings.push(`「${row.targetText}」与原话「${row.sourceText}」的对应只靠少量词，须由译员确认。`);
      }
    }
    if (/(舅|叔|uncle)/iu.test(best.zh.text) && !/(合作社|cooperative)/iu.test(enTurn.text)) {
      warnings.push('原话中的亲属称谓在译文中未交代其后续更正。');
    }
    const zhSigner = signingCues(best.zh.text);
    const enSigner = signingCues(enTurn.text);
    if (zhSigner && enSigner && zhSigner.denied !== enSigner.denied) {
      warnings.push('“没签”的主语在译文里发生了变化，须与中文原话逐一对照。');
    }
    if (enTurn.voice === '译员') {
      warnings.push('译文由译员另记，属于翻译补记，不是来访者原话；两者须并排保留。');
    }
    pairs.push({
      id: `${best.zh.id}-${enTurn.id}`,
      zhTurn: best.zh,
      enTurn,
      zhClauses: zhClauses.map(part => part.text),
      alignment: alignSentences(
        zhClauses.map(part => part.text),
        enClauses.map(part => part.text)
      ),
      warnings
    });
  }
  return pairs;
}

function partnerOf(translation, turnId) {
  const pair = translation.find(item => item.zhTurn.id === turnId || item.enTurn.id === turnId);
  if (!pair) return null;
  return pair.zhTurn.id === turnId ? pair.enTurn.id : pair.zhTurn.id;
}

/**
 * Corrections and supplements recorded after a referral went out are separate
 * notices; the already-received excerpt is never silently rewritten. Each
 * notice is limited to the matter the receiving station handles: a land
 * correction goes to the lease station, a wage correction to the wage station.
 */
function laterCorrections(state, referral) {
  const items = [];
  const stationTopic = referral.toStation === 's1' ? 'land' : referral.toStation === 's2' ? 'wage' : null;
  if (!stationTopic) return items;
  for (const correction of state.clarification.corrections) {
    if (referral.excerptTurns.includes(correction.sourceId)) continue;
    if (correction.target && correction.target !== stationTopic) continue;
    if (!correction.target && stationTopic !== 'land') continue;
    items.push({ sourceId: correction.sourceId, text: correction.text });
  }
  for (const entry of state.supplements) {
    if (referral.excerptTurns.includes(entry.id)) continue;
    if (!(entry.recordedAt > referral.sentAt)) continue;
    const clauses = entry.clauses.filter(clause => stationTopic === 'land'
      ? clause.topic === 'land' || clause.escort || clause.identity.relation || clause.identity.uncleOfVisitor
      : clause.topic === 'wage');
    if (!clauses.length) continue;
    items.push({
      sourceId: entry.id,
      text: entry.text,
      clauses: clauses.map(clause => clause.text)
    });
  }
  return items;
}

export function buildHandoverReview(state, { translation = [] } = {}) {
  return state.referrals.map(referral => {
    const station = state.stationById.get(referral.toStation);
    const scope = station ? stationScope(station) : { topics: [] };

    const rows = referral.excerptTurns.map(turnId => {
      const entry = state.turnById.get(turnId);
      if (!entry) {
        return { turnId, entry: null, topics: [], significant: [], action: 'reject', reason: '资料中无此记录' };
      }
      const topics = [...new Set(entry.clauses
        .map(clause => clause.topic)
        .filter(topic => topic && topic !== 'none'))];
      const significant = topics.filter(topic => topic !== 'mixed');

      if (scope.summaryOnly) {
        return { turnId, entry, topics, significant, action: 'reject', reason: '本站只接收摘要，不接收原话摘录' };
      }

      if (scope.exactTurnsOnly) {
        const partner = partnerOf(translation, turnId);
        if (entry.language === 'en') {
          return {
            turnId,
            entry,
            topics,
            significant,
            action: partner ? 'keep' : 'narrow',
            companion: partner,
            reason: partner ? '' : '译文缺少对应的原话话轮，须一并附上对应原文'
          };
        }
        if (partner) {
          return { turnId, entry, topics, significant, action: 'keep', companion: partner, reason: '' };
        }
        return { turnId, entry, topics, significant, action: 'reject', reason: '不是需翻译的选段' };
      }

      if (entry.worker) {
        return {
          turnId,
          entry,
          topics,
          significant,
          action: 'reject',
          reason: `${entry.voice}的话属于追问或翻译说明，不是当事人陈述，不能作为证据转出`
        };
      }

      const allowed = significant.filter(topic => scope.topics.includes(topic));
      const disallowed = significant.filter(topic => !scope.topics.includes(topic));
      if (disallowed.length && allowed.length) {
        return {
          turnId,
          entry,
          topics,
          significant,
          action: 'narrow',
          allowed,
          disallowed,
          reason: `同一条记录里含${disallowed.map(topic => topicLabel(topic)).join('、')}分句，只能截取${allowed.map(topic => topicLabel(topic)).join('、')}部分`
        };
      }
      if (disallowed.length) {
        return {
          turnId,
          entry,
          topics,
          significant,
          action: 'reject',
          disallowed,
          reason: `含${disallowed.map(topic => topicLabel(topic)).join('、')}分句`
        };
      }
      return { turnId, entry, topics, significant, action: 'keep', reason: '' };
    });

    const rejected = rows.filter(row => row.action === 'reject');
    const narrowed = rows.filter(row => row.action === 'narrow');
    const kept = rows.filter(row => row.action === 'keep');
    const wholeTurn = rows.length > 1 || /整段/.test(referral.item);
    const pairsMissing = kept.filter(row => scope.exactTurnsOnly && !row.companion);

    let verdict = '可以保留';
    if (!kept.length && (rejected.length || narrowed.length)) verdict = '应撤回';
    else if (rejected.length || narrowed.length) verdict = '应更正：保留本事项选段，撤回其余';
    else if (scope.exactTurnsOnly && wholeTurn && pairsMissing.length) verdict = '需收窄可见内容';
    else if (referral.status === '草稿') verdict = '未发出，先核对选段';

    const changes = [];
    const badRows = [...rejected, ...narrowed];
    if (badRows.length) {
      changes.push({
        kind: rejected.length ? 'withdraw' : 'narrow',
        to: referral.toStation,
        basis: badRows.map(row => ({ turnId: row.turnId, reason: row.reason })),
        text: `通知${station ? station.name : referral.toStation}：${referral.id} 中 ${badRows.map(row => row.turnId).join('、')} 不在本站可见范围或超出事项，应予${rejected.length ? '撤回' : '截取'}；原始接访记录不改写，更正依据须随通知留存。`
      });
    }
    if (kept.length && badRows.length) {
      changes.push({
        kind: 'keep',
        to: referral.toStation,
        basis: kept.map(row => ({ turnId: row.turnId, reason: '属于本站事项' })),
        text: `保留 ${kept.map(row => row.turnId).join('、')}，不因撤回其他段落而改动原话。`
      });
    }
    for (const row of kept) {
      if (scope.exactTurnsOnly && row.companion &&
          !referral.excerptTurns.includes(row.companion)) {
        changes.push({
          kind: 'attach',
          to: referral.toStation,
          basis: [{ turnId: row.turnId, reason: '译文须与对应原话同附' }],
          text: `把 ${row.turnId} 与其对应原话 ${row.companion} 一并附上，避免译文脱离正确的话轮；只发需翻译的选段。`
        });
      }
    }
    if (rejected.some(row => row.entry && row.entry.worker)) {
      changes.push({
        kind: 'clarify',
        to: referral.toStation,
        basis: rejected.filter(row => row.entry && row.entry.worker)
          .map(row => ({ turnId: row.turnId, reason: '工作人员说明，非当事人陈述' })),
        text: '说明：被撤回的部分是接访员或译员的说明，属于追问线索或翻译补记，不是来访者陈述。'
      });
    }
    if (badRows.some(row => row.significant && row.significant.includes('wage')) && referral.toStation === 's1') {
      changes.push({
        kind: 'split',
        to: referral.toStation,
        basis: badRows.filter(row => row.significant && row.significant.includes('wage'))
          .map(row => ({ turnId: row.turnId, reason: '工钱事项' })),
        text: '说明：其中的工钱内容属于另一事项，已另行转入务工站的独立摘录，本站不再保留。'
      });
    }
    const later = laterCorrections(state, referral);
    if (later.length && referral.status === '已接收') {
      const notices = later.map(item => {
        const topic = item.clauses && item.clauses.length ? item.clauses.join('，') : item.text;
        return `${item.sourceId}「${topic}」`;
      });
      changes.push({
        kind: 'correct',
        to: referral.toStation,
        basis: later.map(item => ({ turnId: item.sourceId, reason: '发出后的更正或补充' })),
        text: `发出有依据的更正：${[...new Set(notices)].join('；')}。原说法与更正并列保留，接收站须确认后再用。`
      });
    }

    let arrangementEffect;
    if (verdict === '应撤回') {
      arrangementEffect = referral.status === '已接收'
        ? '原安排须暂停，由接收站重新确认后再继续'
        : '尚未发出，无既有安排';
    } else if (verdict === '应更正：保留本事项选段，撤回其余') {
      arrangementEffect = referral.status === '已接收'
        ? '原安排本身有效，只需收窄可见内容；另须发出有依据的更正'
        : '尚未发出，先更正选段，无既有安排';
    } else if (verdict === '需收窄可见内容') {
      arrangementEffect = '原安排有效，只需收窄可见内容，无需重排';
    } else if (verdict === '未发出，先核对选段') {
      arrangementEffect = '尚未发出，无既有安排';
    } else {
      arrangementEffect = '原安排有效';
    }

    const decision = {
      referral: referral.id,
      to: station ? station.name : referral.toStation,
      sentAt: referral.sentAt,
      status: referral.status,
      basis: referral.basisTurns.map(turnId => ({
        turnId,
        text: state.turnById.get(turnId) ? state.turnById.get(turnId).text : '资料中无此记录'
      })),
      excerpt: referral.excerptTurns,
      verdict,
      reason: badRows.length
        ? `${badRows.map(row => `${row.turnId}：${row.reason}`).join('；')}${kept.length ? `；保留 ${kept.map(row => row.turnId).join('、')}` : ''}`
        : '摘录均在接收站可见范围内。',
      arrangement: referral.arrangement,
      arrangementEffect,
      changes: changes.map(change => ({ kind: change.kind, text: change.text, basis: change.basis }))
    };

    return {
      referral,
      station,
      scope,
      rows,
      kept,
      narrowed,
      rejected,
      verdict,
      wholeTurn,
      arrangementEffect,
      changes,
      decision
    };
  });
}

export function buildReassessments(state, { before, after }) {
  const changes = [];
  for (const [index, assessment] of after.entries()) {
    const prior = before[index];
    if (!prior) continue;
    for (const topic of ['land', 'wage']) {
      const old = prior.matters[topic];
      const now = assessment.matters[topic];
      if (old.status === now.status && old.missing.join() === now.missing.join()) continue;
      changes.push({
        stationId: assessment.stationId,
        station: assessment.station.name,
        topic,
        from: old.status,
        to: now.status,
        missingResolved: old.missing.filter(item => !now.missing.includes(item)),
        missingRemaining: now.missing,
        reason: '来访者补充身份关系、签字人或地点后，重新判断能否留在原站。'
      });
    }
  }
  return { before, after, changes };
}

export function buildDecisionLog(state, { assessments, handover, clarification }) {
  const log = [];
  for (const assessment of assessments) {
    for (const topic of ['land', 'wage']) {
      const matter = assessment.matters[topic];
      if (matter.status === 'outOfScope') continue;
      log.push({
        kind: 'assessment',
        station: assessment.station.name,
        topic,
        decision: matter.status,
        basis: matter.transferable.map(turnId => ({
          turnId,
          text: state.recordById.get(turnId) ? state.recordById.get(turnId).text : ''
        })),
        reason: matter.reason,
        missing: matter.missing
      });
    }
  }
  for (const entry of handover) log.push({ kind: 'handover', ...entry.decision });
  for (const correction of clarification.corrections) {
    log.push({
      kind: 'correction',
      turnId: correction.sourceId,
      text: correction.text,
      target: correction.target || '待确认',
      reason: correction.scopeNote
    });
  }
  return log;
}

export function buildReport(state) {
  const clarification = buildClarification(state);
  state.clarification = clarification;
  const translation = buildTranslation(state);
  const assessments = buildAssessments(state);

  const withoutSupplements = {
    ...state,
    clarification: buildClarification(state, { includeSupplements: false })
  };
  const reassessments = buildReassessments(state, {
    before: buildAssessments(withoutSupplements),
    after: assessments
  });

  const handover = buildHandoverReview(state, { translation });
  const decisionLog = buildDecisionLog(state, { assessments, handover, clarification });

  return {
    disclaimer: DISCLAIMER,
    phases: PHASES,
    speakers: clarification.speakers,
    buckets: clarification.buckets,
    corrections: clarification.corrections,
    pending: clarification.pending,
    additions: clarification.additions,
    roles: clarification.roles,
    roleLabels: ROLE_LABELS,
    questions: clarification.questions,
    assessments,
    reassessments,
    handover,
    translation,
    decisionLog,
    glossary: state.glossary
  };
}
