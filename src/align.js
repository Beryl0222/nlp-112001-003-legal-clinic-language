// Word-level cues used to align a translated sentence with the source clause
// it belongs to. Alignment is by shared meaning, never by position: a
// translation may merge two clauses or move a relation into the next sentence.

const CUES = [
  ['representative', /(?:替|帮|代)[^，。；]{0,8}(?:问|咨询)|on behalf of|\basked me to\b/iu],
  ['representativeShort', /替[^，。；]{0,6}问/iu],
  ['kinshipUncle', /舅|叔|uncle/iu],
  ['kinshipHer', /她舅|他舅|her uncle/iu],
  ['sign', /签|\bsign(?:ed|s)?\b/iu],
  ['signDenied', /没签|未签|did not sign|didn't sign/iu],
  ['signAsked', /让[^，。；]{0,6}签|叫[^，。；]{0,6}签|asked[^.]{0,20}to sign/iu],
  ['cooperative', /合作社|cooperative/iu],
  ['passed', /转话|转达|转告|passed/iu],
  ['lease', /租地|租赁|lease/iu],
  ['land', /土地|地块|\bland\b/iu],
  ['copy', /副本|一份|\bcopy\b/iu],
  ['wage', /工钱|工资|薪水|wage|salary|pay/iu],
  ['owed', /欠|拖|没拿到|未拿到|unpaid|owed/iu],
  ['month', /上月|本月|last month/iu],
  ['money', /钱|元|块|money/iu],
  ['correction', /讲错|说错|不是|只是|no[,.]|only|actually/iu],
  ['place', /青涧|柘坪|锦城|村|镇|工地/iu],
  ['police', /派出所|民警|公安|police/iu],
  ['injury', /伤|工伤|injur/iu]
];

export function cueSet(text) {
  const set = new Set();
  for (const [name, pattern] of CUES) {
    if (pattern.test(text)) set.add(name);
  }
  if (set.has('signDenied')) set.delete('sign');
  return set;
}

export function overlapScore(a, b) {
  let score = 0;
  for (const cue of a) {
    if (b.has(cue)) score += cue === 'sign' ? 2 : 3;
  }
  return score;
}

export function sharedCues(a, b) {
  return [...a].filter(cue => b.has(cue));
}

/**
 * Monotonic alignment by maximum shared cues. Returns one entry per
 * translation sentence with its source clause index or null. A sentence that
 * shares no cue with any clause is left unaligned and reported as such.
 */
export function alignSentences(sourceTexts, targetTexts) {
  const left = sourceTexts.map(cueSet);
  const right = targetTexts.map(cueSet);
  const rows = left.length;
  const cols = right.length;
  const score = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  const take = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));

  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      const pair = score[i - 1][j - 1] + overlapScore(left[i - 1], right[j - 1]);
      let best = score[i - 1][j];
      let choice = 1;
      if (score[i][j - 1] > best) {
        best = score[i][j - 1];
        choice = 2;
      }
      if (pair > best) {
        best = pair;
        choice = 3;
      }
      score[i][j] = best;
      take[i][j] = choice;
    }
  }

  const mapping = new Array(cols).fill(null);
  const confidence = new Array(cols).fill(0);
  let i = rows;
  let j = cols;
  while (i > 0 && j > 0) {
    const choice = take[i][j];
    if (choice === 3) {
      mapping[j - 1] = i - 1;
      confidence[j - 1] = overlapScore(left[i - 1], right[j - 1]);
      i -= 1;
      j -= 1;
    } else if (choice === 2) {
      j -= 1;
    } else {
      i -= 1;
    }
  }

  return mapping.map((index, position) => ({
    targetIndex: position,
    sourceIndex: index,
    aligned: index !== null && confidence[position] > 0,
    confidence: confidence[position],
    cues: index === null ? [] : sharedCues(left[index], right[position]),
    sourceText: index === null ? null : sourceTexts[index],
    targetText: targetTexts[position]
  }));
}
