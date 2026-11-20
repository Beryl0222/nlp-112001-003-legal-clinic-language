import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { readExtras } from '../src/extras.js';
import { buildWorkspace, buildReport } from '../src/analysis.js';
import { renderReport } from '../src/render.js';
import { splitClauses } from '../src/text.js';
import { alignSentences } from '../src/align.js';
import { classifyTopic, hasNamedCounterparty, kinshipReferences, placeCues, signingCues } from '../src/lexicon.js';

async function inputs() {
  const [base, extra] = await Promise.all([readMaterials(), readExtras()]);
  return { ...base, ...extra };
}

async function analyse() {
  return buildReport(buildWorkspace(await inputs()));
}

test('分句保留原文位置且不拆开顿号列举', () => {
  const text = '我是替阿兰问，她舅让签租地的纸，没给她留一份。我可没签。';
  const parts = splitClauses(text);
  assert.deepEqual(parts.map(part => part.text), [
    '我是替阿兰问',
    '她舅让签租地的纸',
    '没给她留一份',
    '我可没签'
  ]);
  for (const part of parts) {
    assert.equal(text.slice(part.start, part.end), part.text);
  }
  assert.equal(splitClauses('甲、乙、丙三人')[0].text, '甲、乙、丙三人');
});

test('一句话只归入它自己支持的事项', () => {
  assert.equal(classifyTopic('让她签的是合作社的人').topic, 'land');
  assert.equal(classifyTopic('是我没拿到上月工钱').topic, 'wage');
  assert.equal(classifyTopic('前面我讲错了').topic, 'none');
  assert.equal(classifyTopic('青涧和柘坪都在县里').topic, 'none');
});

test('签字被拆成被要求签、实际签、没有签三种事实', () => {
  const asked = signingCues('她舅让签租地的纸');
  assert.equal(asked.asked, true);
  assert.equal(asked.denied, false);
  assert.equal(asked.admitted, false);

  const denied = signingCues('我可没签');
  assert.equal(denied.denied, true);

  const admitted = signingCues('字是阿兰自己签的');
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.admittedByName, '阿兰');
});

test('亲属称谓未写明所指时标为待确认关系', () => {
  const [unnamed] = kinshipReferences('她舅让签的');
  assert.equal(unnamed.named, false);
  assert.equal(unnamed.pronoun, '她');
  const [named] = kinshipReferences('阿兰的舅只是转话');
  assert.equal(named.named, true);
  assert.equal(named.referent, '阿兰');
});

test('地点要区分事件发生地与转介地点', () => {
  const vague = placeCues('还有钱的事是在青涧');
  assert.equal(vague.ambiguous, true);
  assert.deepEqual(vague.names, ['青涧']);
  const specific = placeCues('租地的事在柘坪村东头');
  assert.equal(specific.ambiguous, false);
  assert.equal(specific.names[0], '柘坪村');
});

test('未具名的合作社不算已说明相对方名称', () => {
  assert.equal(hasNamedCounterparty('让她签的是合作社的人'), false);
  assert.equal(hasNamedCounterparty('合作社的名称、经办人是谁'), false);
  assert.equal(hasNamedCounterparty('东山合作社让签的'), true);
});

test('译文按内容对齐到正确的话轮，不按相邻编号', async () => {
  const rows = alignSentences(
    ['我是替阿兰问', '她舅让签租地的纸', '没给她留一份', '我可没签'],
    ['Lan says her uncle did it', 'I did not sign']
  );
  assert.equal(rows[0].sourceText, '她舅让签租地的纸');
  assert.equal(rows[1].sourceText, '我可没签');

  const report = await analyse();
  assert.deepEqual(report.translation.map(pair => pair.id), ['t1-t3', 't5-t6']);
  assert.equal(report.translation[0].zhTurn.id, 't1');
});

test('同一人在两件事中的角色分别记录', async () => {
  const report = await analyse();
  const landRoles = report.roles.land.map(role => `${role.role}:${role.person}`);
  const wageRoles = report.roles.wage.map(role => `${role.role}:${role.person}`);
  assert.ok(landRoles.includes('representative:来访人甲'));
  assert.ok(landRoles.includes('signed:阿兰'));
  assert.ok(landRoles.includes('didNotSign:来访人甲'));
  assert.ok(wageRoles.includes('subject:来访人甲'));
  assert.ok(!wageRoles.some(role => role.endsWith('阿兰')));
  assert.ok(!landRoles.includes('subject:来访人甲'));
});

test('指向不明的更正不自动套到某一事项', async () => {
  const report = await analyse();
  const loose = report.corrections.find(item => item.text === '前面我讲错了');
  assert.equal(loose.target, null);
  const targeted = report.corrections.find(item => item.text === '阿兰的舅只是转话');
  assert.equal(targeted.target, 'land');
});

test('来访者的更正保留在原事项，不影响工资事项', async () => {
  const report = await analyse();
  const wageBasis = report.assessments.find(item => item.stationId === 's2').matters.wage.transferable;
  assert.deepEqual(wageBasis, ['t4', 'u3']);
  assert.ok(!wageBasis.includes('t5'));
});

test('接待站只接收本事项的选段', async () => {
  const report = await analyse();
  const lease = report.assessments.find(item => item.stationId === 's1').matters;
  assert.equal(lease.wage.status, 'outOfScope');
  assert.deepEqual(lease.land.transferable, ['t1', 't5', 'u2']);
  assert.ok(lease.land.blocking.length > 0);
  assert.ok(lease.land.needs.length > 0);

  const wage = report.assessments.find(item => item.stationId === 's2').matters;
  assert.equal(wage.land.status, 'outOfScope');
});

test('补充关系与地点后重新判断各站能否留下', async () => {
  const report = await analyse();
  const land = report.reassessments.changes.find(change => change.topic === 'land' && change.stationId === 's1');
  assert.ok(land);
  assert.ok(land.missingResolved.includes('土地所在地未见说明'));
  assert.ok(land.missingResolved.includes('“谁实际签了”尚待确认'));
  assert.ok(land.missingRemaining.includes('亲属称谓所指待确认'));

  const wage = report.reassessments.changes.find(change => change.topic === 'wage' && change.stationId === 's2');
  assert.ok(wage.missingResolved.includes('工资发生地未见说明'));
});

test('整段转出夹带其他事项时要求撤回并留下依据', async () => {
  const report = await analyse();
  const r1 = report.handover.find(entry => entry.referral.id === 'r1');
  assert.equal(r1.verdict, '应更正：保留本事项选段，撤回其余');
  const withdrawn = r1.changes.find(change => change.kind === 'withdraw');
  assert.ok(withdrawn.basis.some(item => item.turnId === 't4'));
  assert.ok(withdrawn.basis.some(item => item.turnId === 't2'));
  assert.match(withdrawn.text, /原始接访记录不改写/);
  assert.ok(r1.changes.some(change => change.kind === 'split'));
  assert.ok(r1.changes.some(change => change.kind === 'correct'));
  assert.ok(r1.kept.some(row => row.turnId === 't1'));
  assert.match(r1.arrangementEffect, /收窄可见内容/);
});

test('只含本事项选段的已接收转介可以保留', async () => {
  const report = await analyse();
  const r2 = report.handover.find(entry => entry.referral.id === 'r2');
  assert.equal(r2.verdict, '可以保留');
  assert.equal(r2.arrangementEffect, '原安排有效');
  assert.deepEqual(r2.rejected, []);
});

test('草稿转介尚未发出，只核对选段', async () => {
  const report = await analyse();
  const r3 = report.handover.find(entry => entry.referral.id === 'r3');
  assert.equal(r3.verdict, '未发出，先核对选段');
  assert.equal(r3.arrangementEffect, '尚未发出，无既有安排');
});

test('译文要与对应原话同附，并说明原安排是否有效', async () => {
  const report = await analyse();
  const r4 = report.handover.find(entry => entry.referral.id === 'r4');
  assert.equal(r4.verdict, '应更正：保留本事项选段，撤回其余');
  assert.ok(r4.changes.some(change => change.kind === 'attach' && change.text.includes('t1')));
  assert.ok(r4.rejected.some(row => row.turnId === 't4'));
  assert.match(r4.arrangementEffect, /原安排本身有效/);
});

test('接访员与译员的说明不进入两个事项站的事实摘录', async () => {
  const report = await analyse();
  const speech = report.buckets.withheld.statements.map(item => item.sourceId);
  assert.ok(speech.includes('t2'));
  assert.ok(speech.includes('t3'));

  for (const assessment of report.assessments.filter(item => item.stationId !== 's3')) {
    for (const topic of ['land', 'wage']) {
      for (const turnId of assessment.matters[topic].transferable) {
        assert.ok(!['t2', 't3', 't6'].includes(turnId), `${assessment.stationId} 夹带了 ${turnId}`);
      }
    }
  }

  // The translation desk may receive translated passages, but they stay
  // labelled as translation material rather than as facts.
  const desk = report.assessments.find(item => item.stationId === 's3');
  assert.equal(desk.matters.land.status, 'translationOnly');
  assert.deepEqual(desk.matters.land.transferable, ['t3', 't6']);
  assert.match(desk.matters.land.reason, /不作为事项证据/);
});

test('假设与举例进入待核实而不是事实', async () => {
  const report = await analyse();
  assert.ok(report.pending.some(item => item.sourceId === 't2'));
  assert.ok(!report.buckets.land.statements.some(item => item.sourceId === 't2'));
});

test('每次判断都能回查到依据原话', async () => {
  const report = await analyse();
  assert.ok(report.decisionLog.length >= 6);
  for (const entry of report.decisionLog) {
    if (entry.kind === 'assessment') {
      for (const basis of entry.basis) assert.ok(basis.text);
    }
    if (entry.kind === 'handover') assert.ok(entry.basis.length > 0);
  }
  assert.ok(report.decisionLog.some(entry => entry.kind === 'correction'));
});

test('报告保留免责声明并渲染成可读文本', async () => {
  const report = await analyse();
  assert.match(report.disclaimer, /不构成法律意见/);
  const markdown = renderReport(report);
  assert.match(markdown, /接访事实澄清与分流报告/);
  assert.match(markdown, /不代替接访人员的判断/);
  assert.match(markdown, /t1 ↔ t3/);
  for (const entry of report.handover) assert.match(markdown, new RegExp(entry.referral.id));
});

test('词表与站点说明来自项目内合成资料', async () => {
  const report = await analyse();
  assert.ok(report.glossary.length >= 5);
  for (const entry of report.glossary) {
    assert.ok(entry.zh && entry.en && entry.note);
  }
  const stations = await readFile(new URL('../资料/服务站.json', import.meta.url), 'utf8');
  assert.match(stations, /巡回翻译席/);
});

test('补充资料缺失时仍能生成报告', async () => {
  const [base] = await Promise.all([readMaterials()]);
  const report = buildReport(buildWorkspace({
    ...base,
    '转介.json': [],
    '补充.json': [],
    '词表.json': []
  }));
  assert.deepEqual(report.translation.map(pair => pair.id), ['t1-t3', 't5-t6']);
  assert.equal(report.handover.length, 0);
  assert.equal(report.assessments.find(item => item.stationId === 's1').matters.land.status, 'partial');
});

test('补充资料的字段不合约定时指出文件名和条号', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, sep } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const scratch = await mkdtemp(join(tmpdir(), 'extras-'));
  try {
    const directory = join(scratch, '材料');
    await mkdir(directory);
    await writeFile(join(directory, '转介.json'), '[{"id":"r1"}]');
    await assert.rejects(readExtras(pathToFileURL(directory + sep)), error => {
      assert.ok(error instanceof TypeError);
      assert.ok(error.message.includes('转介.json'));
      assert.ok(error.message.includes('第 1 条'));
      return true;
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
