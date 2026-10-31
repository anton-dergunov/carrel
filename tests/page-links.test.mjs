import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerFile, destFor, findCitations, namesAnother, namesPattern, pageHref, shortName } from '../src/carrel/static/page-links.js';
import { parsePaperLink } from '../src/carrel/static/links.js';

/** Each citation found, as [its text, page, dest]. */
const cites = (text) => findCitations(text).map(({ start, end, page, dest }) => [text.slice(start, end), page, dest]);

test('the passing citations of a real answer, with their labels', () => {
  assert.deepEqual(
    cites('The GPT-4o judge is described on p. 5. Its meta-evaluation is Table 6 on p. 20, with the per-type judge prompts at Fig. 10 (p. 20).'),
    [
      ['p. 5', 5, undefined],
      ['Table 6 on p. 20', 20, 'table.6'],
      ['Fig. 10 (p. 20)', 20, 'figure.10'],
    ],
  );
});

test('a range opens its first page', () => {
  assert.deepEqual(cites('**Design results, p. 8–10.**'), [['p. 8–10', 8, undefined]]);
  assert.deepEqual(cites('read pp. 4-6 and pages 19–20'), [
    ['pp. 4-6', 4, undefined],
    ['pages 19–20', 19, undefined],
  ]);
  assert.deepEqual(cites('(Table 8, p. 26–27)'), [['Table 8, p. 26–27', 26, 'table.8']]);
});

test('a label after the page, in the guide\'s style', () => {
  assert.deepEqual(cites('see p. 7, Table 2.'), [['p. 7, Table 2', 7, 'table.2']]);
  assert.deepEqual(cites('(p. 10, Fig. 13a)'), [['p. 10, Fig. 13a', 10, 'figure.13']]);
});

test('sections and appendices name their destinations', () => {
  assert.deepEqual(cites('(§5.2–5.4, p. 8)'), [['§5.2–5.4, p. 8', 8, 'subsection.5.2']]);
  assert.deepEqual(cites('Section 3 on page 4'), [['Section 3 on page 4', 4, 'section.3']]);
  assert.deepEqual(cites('Appendix A.3, p. 19'), [['Appendix A.3, p. 19', 19, 'subsection.A.3']]);
  assert.equal(destFor('Appendix B'), 'appendix.B');
  assert.equal(destFor('§2.2.3'), 'subsubsection.2.2.3');
  assert.equal(destFor('Eq. 4'), undefined);
});

test('a page inside a longer number is not a citation', () => {
  assert.deepEqual(cites('p. 7.5 and p. 12,000'), []);
  assert.deepEqual(cites('a 3 p. 7 b'), [['p. 7', 7, undefined]]);
  assert.deepEqual(cites('Figure 6 shows it (p. 10)'), [['p. 10', 10, undefined]]);
});

test('a link to a page in the form the viewers read', () => {
  const href = pageHref("llm/x/Don't be lazy. A & B #1.pdf", 20, 'table.6');
  assert.deepEqual(parsePaperLink(href), {
    file: "llm/x/Don't be lazy. A & B #1.pdf",
    page: 20,
    dest: 'table.6',
    search: undefined,
    rect: undefined,
  });
  assert.equal(pageHref('a/B c.pdf', 3), 'http://pdf.invalid/a/B%20c.pdf?page=3');
});

test('the paper an answer is about', () => {
  const asked = 'llm/LongMemEval.pdf';
  assert.equal(answerFile(asked, []), asked);
  assert.equal(answerFile(asked, [asked, asked]), asked);
  // It links another paper: a plain page could be either's.
  assert.equal(answerFile(asked, [asked, 'llm/Zep.pdf']), undefined);
  // Asked about none: the one paper it links.
  assert.equal(answerFile(undefined, ['llm/Zep.pdf', 'llm/Zep.pdf']), 'llm/Zep.pdf');
  assert.equal(answerFile(undefined, ['llm/Zep.pdf', asked]), undefined);
  assert.equal(answerFile(undefined, []), undefined);
});

test('a paper\'s short name, from its title', () => {
  assert.equal(shortName('Zep: A Temporal Knowledge Graph Architecture for Agent Memory'), 'Zep');
  assert.equal(shortName("Don't be lazy: CompleteP enables compute-efficient deep transformers"), "Don't be lazy");
  assert.equal(shortName('FASTopic. Pretrained Transformer is a Fast Topic Model'), 'FASTopic');
  assert.equal(shortName('A Survey on Neural Topic Models: Methods, Applications, and Challenges'), undefined);
  assert.equal(shortName('Attention Is All You Need'), undefined);
});

test('a citation named for another paper stays plain', () => {
  const names = namesPattern(['FASTopic', 'Orca']);
  assert.ok(namesAnother('its evidence is the automatic metrics only (FASTopic paper, ', names));
  assert.ok(namesAnother('which this survey lacks (the note puts them at FASTopic ', names));
  // Its sentence ended before the citation.
  assert.ok(!namesAnother('My pick is FASTopic. - **Survey, ', names));
  // Too far back, or only a longer word.
  assert.ok(!namesAnother('FASTopic is newer, and the survey itself says nothing about it (', names));
  assert.ok(!namesAnother('the FASTopicX model (', names));
  assert.ok(!namesAnother('FASTopic paper, ', namesPattern([])));
});
