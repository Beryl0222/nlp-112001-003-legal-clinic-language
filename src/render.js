import { topicLabel } from './lexicon.js';

const STATUS_LABELS = {
  eligible: '可转介',
  partial: '部分可转介',
  pending: '待补问',
  outOfScope: '不在本站范围',
  translationOnly: '只处理语言补问'
};

function header(text, level = 2) {
  return `${'#'.repeat(level)} ${text}`;
}

function list(items) {
  return items.map(item => `- ${item}`).join('\n');
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const rule = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${row.join(' | ')} |`).join('\n');
  return [head, rule, body].join('\n');
}

function quote(text) {
  return `> ${text}`;
}

function renderRoles(roles, labels) {
  const lines = [];
  for (const role of roles) {
    const label = labels[role.role] || role.role;
    const who = role.for ? `${role.person}（代 ${role.for}）` : role.person;
    const prior = role.priorBasis ? `；先前的待确认依据 ${role.priorBasis.join('、')} 已并入` : '';
    lines.push(`${label}：${who}（${role.status}，依据 ${role.basis.join('、') || '未记录'}${prior}）`);
  }
  return lines;
}

export function renderReport(report) {
  const out = [];
  out.push('# 接访事实澄清与分流报告（草稿，供工作人员复核）');
  out.push('');
  out.push(quote(report.disclaimer));
  out.push('');

  out.push(header('一、按事项归入的原话'));
  for (const topic of ['land', 'wage']) {
    const bucket = report.buckets[topic];
    out.push(header(`${topicLabel(topic)}事项`, 3));
    if (!bucket.statements.length) {
      out.push('暂无归入该事项的分句。');
    } else {
      const rows = bucket.statements.map(item => [
        item.sourceId,
        item.voice,
        item.text.replace(/\|/g, '｜'),
        item.markers.join('、') || '—',
        item.reported ? '转述，仅作线索' : '当事人陈述'
      ]);
      out.push(table(['记录', '说话人', '原话分句', '标记', '性质'], rows));
    }
    if (bucket.questions.length) {
      out.push('');
      out.push('**建议追问**');
      out.push('');
      out.push(list(bucket.questions.map(question =>
        `${question.ask}${question.basis && question.basis.length ? `（依据：${Array.isArray(question.basis) ? question.basis.join('、') : question.basis}）` : ''}${question.separates ? `\n  - 为什么要分开：${question.separates}` : ''}`)));
    }
  }

  out.push('');
  out.push(header('二、身份与角色（按事项分别记录）'));
  for (const topic of ['land', 'wage']) {
    out.push(header(`${topicLabel(topic)}事项`, 3));
    const roles = report.roles[topic];
    out.push(roles.length
      ? list(renderRoles(roles, report.roleLabels))
      : '尚未记录角色。');
  }

  out.push('');
  out.push(header('三、未归入事项或不能作为证据的说法'));
  const unassigned = report.buckets.unassigned.statements;
  out.push(unassigned.length
    ? list(unassigned.map(item => `${item.sourceId}「${item.text}」${item.note ? `——${item.note}` : ''}`))
    : '无。');
  const withheld = report.buckets.withheld.statements;
  if (withheld.length) {
    out.push('');
    out.push('接访员或译员的说明（不作为当事人陈述转出）：');
    out.push('');
    out.push(list(withheld.map(item => `${item.sourceId}「${item.text}」`)));
  }
  if (report.pending.length) {
    out.push('');
    out.push('待核实是否为当事人亲历：');
    out.push('');
    out.push(list(report.pending.map(item => `${item.sourceId}「${item.text}」——${item.reason}`)));
  }

  out.push('');
  out.push(header('四、更正与原始说法的关系'));
  out.push(report.corrections.length
    ? list(report.corrections.map(item =>
      `${item.sourceId}「${item.text}」→ 指向事项：${item.target ? topicLabel(item.target) : '待确认'}；${item.scopeNote}`))
    : '暂无更正记录。');

  out.push('');
  out.push(header('五、各事项能否留在本站'));
  const rows = [];
  for (const assessment of report.assessments) {
    for (const topic of ['land', 'wage']) {
      const matter = assessment.matters[topic];
      rows.push([
        assessment.station.name,
        topicLabel(topic),
        STATUS_LABELS[matter.status] || matter.status,
        matter.transferable.join('、') || '—',
        matter.blocking.length ? matter.blocking.join('；') : '—',
        matter.needs.length ? matter.needs.join('；') : '—'
      ]);
    }
  }
  out.push(table(['站', '事项', '判断', '可先转出的选段', '先补问才能留下', '可留待补问'], rows));

  out.push('');
  out.push(header('六、补充说明后的重判'));
  out.push(report.reassessments.changes.length
    ? list(report.reassessments.changes.map(change =>
      `${change.station}·${topicLabel(change.topic)}：${STATUS_LABELS[change.from] || change.from} → ${STATUS_LABELS[change.to] || change.to}` +
      `${change.missingResolved.length ? `；已解决：${change.missingResolved.join('、')}` : ''}` +
      `${change.missingRemaining.length ? `；仍缺：${change.missingRemaining.join('、')}` : ''}——${change.reason}`))
    : '补充材料没有改变任何事项的判断。');

  out.push('');
  out.push(header('七、翻译补记与原话对照'));
  out.push(report.translation.length
    ? report.translation.map(pair => {
      const lines = [`**${pair.zhTurn.id} ↔ ${pair.enTurn.id}**`, ''];
      lines.push(quote(`原话（${pair.zhTurn.voice}）：${pair.zhTurn.text}`));
      lines.push(quote(`译文（${pair.enTurn.voice}）：${pair.enTurn.text}`));
      lines.push('');
      lines.push('| 译文句 | 对应原话分句 | 对应强度 |');
      lines.push('| --- | --- | --- |');
      for (const row of pair.alignment) {
        lines.push(`| ${row.targetText.replace(/\|/g, '｜')} | ${row.aligned ? row.sourceText.replace(/\|/g, '｜') : '（找不到对应分句，待译员说明）'} | ${row.aligned ? row.confidence : '—'} |`);
      }
      if (pair.warnings.length) {
        lines.push('');
        lines.push(list(pair.warnings.map(warning => `注意：${warning}`)));
      }
      return lines.join('\n');
    }).join('\n\n')
    : '没有可对照的译文。');

  out.push('');
  out.push(header('八、已接收转介的复核'));
  for (const entry of report.handover) {
    out.push(header(`${entry.referral.id} → ${entry.station ? entry.station.name : entry.referral.toStation}`, 3));
    out.push(`判断：**${entry.verdict}**。${entry.arrangementEffect}。`);
    if (entry.referral.arrangement) out.push(`原安排：${entry.referral.arrangement}`);
    out.push('');
    out.push(table(
      ['摘录', '处理', '理由'],
      entry.rows.map(row => [row.turnId, row.action === 'keep' ? '保留' : row.action === 'narrow' ? '截取' : '撤回', row.reason || '—'])
    ));
    if (entry.changes.length) {
      out.push('');
      out.push('**需要发给接收方的更正**');
      out.push('');
      out.push(list(entry.changes.map(change => `${change.text}（依据：${change.basis.map(basis => basis.turnId).join('、') || entry.referral.basisTurns.join('、')}）`)));
    }
  }

  out.push('');
  out.push(header('九、决定记录（回查用）'));
  out.push(list(report.decisionLog.map(item => {
    if (item.kind === 'assessment') {
      return `[判断] ${item.station}·${topicLabel(item.topic)}：${STATUS_LABELS[item.decision] || item.decision}；依据 ${item.basis.map(basis => basis.turnId).join('、') || '无'}；${item.reason}`;
    }
    if (item.kind === 'handover') {
      return `[交接] ${item.referral} → ${item.to}（${item.sentAt}，${item.status}）：${item.verdict}；摘录 ${item.excerpt.join('、')}；${item.reason}`;
    }
    return `[更正] ${item.turnId}「${item.text}」：指向 ${item.target === 'land' || item.target === 'wage' ? topicLabel(item.target) : item.target}；${item.reason}`;
  })));

  out.push('');
  out.push(header('十、词表（练习用）'));
  out.push(table(['中文', '英文', '事项', '说明'],
    report.glossary.map(entry => [entry.zh, entry.en, entry.topic, entry.note])));

  out.push('');
  out.push(quote('本报告中的“可转介”“可保留”只表示材料在事项和可见范围上相符，不是法律结论。'));
  out.push('');
  return out.join('\n');
}
