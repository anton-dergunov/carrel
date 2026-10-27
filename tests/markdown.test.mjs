import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownHtml } from '../src/carrel/static/markdown.js';

const inline = (tex) => `<span class="maths">${tex}</span>`;
const display = (tex) => `<span class="maths display">${tex}</span>`;

test('maths in a line, in both forms', () => {
  assert.equal(markdownHtml('So $x^2$ and \\(y_i\\).'), `<p>So ${inline('x^2')} and ${inline('y_i')}.</p>\n`);
});

test('maths set apart, in both forms', () => {
  assert.equal(markdownHtml('$$\n\\sum_i x_i\n$$'), '<div class="maths display">\\sum_i x_i</div>\n');
  assert.equal(markdownHtml('\\[\na < b\n\\]\n\nText.'), '<div class="maths display">a &lt; b</div>\n<p>Text.</p>\n');
  // Inside a paragraph, and right after one.
  assert.equal(markdownHtml('It is $$a+b$$ here.'), `<p>It is ${display('a+b')} here.</p>\n`);
  assert.equal(markdownHtml('Before:\n$$\nz\n$$'), '<p>Before:</p>\n<div class="maths display">z</div>\n');
});

test('money is not maths', () => {
  assert.equal(markdownHtml('It costs $5 and $10.'), '<p>It costs $5 and $10.</p>\n');
  assert.equal(markdownHtml('From $ 3 to $ 4.'), '<p>From $ 3 to $ 4.</p>\n');
  assert.equal(markdownHtml('An escaped \\$x\\$ stays.'), '<p>An escaped $x$ stays.</p>\n');
});

test('code keeps its dollars', () => {
  assert.equal(markdownHtml('Run `echo $HOME $PATH`.'), '<p>Run <code>echo $HOME $PATH</code>.</p>\n');
  assert.equal(
    markdownHtml('```sh\necho $$ $x$\n```'),
    '<pre><code class="language-sh">echo $$ $x$\n</code></pre>\n',
  );
});

test('a formula still streaming is text until it closes', () => {
  assert.equal(markdownHtml('So $x^'), '<p>So $x^</p>\n');
  assert.equal(markdownHtml('$$\n\\frac{a}'), '<p>$$\n\\frac{a}</p>\n');
});

test('the TeX is escaped, not HTML', () => {
  assert.equal(markdownHtml('$a<b>c$'), `<p>${inline('a&lt;b&gt;c')}</p>\n`);
});

test('maths in a table', () => {
  const html = markdownHtml('| a | $x$ |\n|---|---|\n| 1 | \\(y\\) |');
  assert.match(html, /<th><span class="maths">x<\/span><\/th>/);
  assert.match(html, /<td><span class="maths">y<\/span><\/td>/);
});
