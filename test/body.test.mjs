import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBody } from '../src/lib/body.ts';

test('story text: paragraphs, headings, lists, quotes, links', () => {
  const html = renderBody('One.\nTwo.\n\n## Heading\n- a\n- b\n> quoted\nhttps://example.com/x.');
  assert.equal(
    html,
    '<p>One.<br />Two.</p>\n<h2>Heading</h2>\n<ul><li>a</li><li>b</li></ul>\n<blockquote>quoted</blockquote>\n<p><a href="https://example.com/x" rel="noopener">https://example.com/x</a>.</p>',
  );
});

test('story text is escaped', () => {
  assert.equal(renderBody('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.ok(!renderBody('javascript:alert(1)').includes('<a'));
});
