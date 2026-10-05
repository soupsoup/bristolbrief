import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickStories, pickMeetings, trimSummary, cleanLink, buildNewsletter, pickScores, isScoreHeadline, outOfState, shortHeadline, subjectFor, previewFor } from '../scripts/lib/newsletter.mjs';

const now = new Date('2026-10-01T10:00:00Z');
const hoursAgo = (h) => new Date(now.valueOf() - h * 3600e3).toISOString();
const item = (o) => ({
  id: o.id ?? o.title,
  title: o.title,
  summary: o.summary ?? 'A long enough summary of the story that passes the minimum length check for the newsletter.',
  date: hoursAgo(o.age ?? 3),
  source: o.source ?? 'a',
  sourceName: o.sourceName ?? 'Outlet A',
  category: o.category ?? 'news',
  section: o.section ?? 'news',
  towns: o.towns ?? ['taunton'],
  link: o.link ?? 'https://example.com/' + (o.id ?? o.title).replace(/\W+/g, '-'),
  ...(o.team && { team: o.team }),
});

test('trimSummary strips bylines, press-release labels and soft hyphens, and cuts at a sentence', () => {
  assert.equal(trimSummary('By Beth David, Editor Town votes on budget.'), 'Town votes on budget.');
  assert.equal(trimSummary('Acushnet Fire Department Press Release Crews responded to a crash.'), 'Crews responded to a crash.');
  assert.equal(trimSummary('Depart­ments met.'), 'Departments met.');
  const two = 'The council voted to approve the harbor plan after a long meeting on Tuesday night. ' + 'More detail follows '.repeat(10);
  assert.equal(trimSummary(two, 100), 'The council voted to approve the harbor plan after a long meeting on Tuesday night.');
  assert.ok(trimSummary('word '.repeat(80), 60).endsWith('…'));
});

test('cleanLink removes utm parameters only', () => {
  assert.equal(cleanLink('https://x.com/a?id=2&utm_source=rss&utm_medium=rss'), 'https://x.com/a?id=2');
});

test('pickStories skips old items, listings, sports, team stories and thin summaries', () => {
  const picked = pickStories(
    [
      item({ title: 'Fresh council vote on schools', source: 's1' }),
      item({ title: 'Yesterday old story about bridge', age: 40, source: 's2' }),
      item({ title: 'House for sale on Main', section: 'listings', source: 's3' }),
      item({ title: 'Bruins win overtime', team: 'bruins', source: 's4' }),
      item({ title: 'Soccer team wins', section: 'sports', source: 's5' }),
      item({ title: 'Short summary story', summary: 'Too short.', source: 's6' }),
    ],
    { now },
  );
  assert.deepEqual(picked.map((s) => s.title), ['Fresh council vote on schools']);
});

test('pickStories leads with the story several outlets ran, and keeps one copy of it', () => {
  const picked = pickStories(
    [
      item({ title: 'Mayor announces harbor dredging project', source: 'a', section: 'government', age: 2 }),
      item({ title: 'Attorney general releases diocese abuse investigation', source: 'b', age: 6 }),
      item({ title: 'Diocese abuse investigation released by attorney general', source: 'c', age: 7 }),
      item({ title: 'Attorney general diocese investigation finds abuse decades', source: 'd', age: 8 }),
    ],
    { now },
  );
  assert.match(picked[0].title, /diocese/i);
  assert.equal(picked.filter((s) => /diocese/i.test(s.title)).length, 1);
});

test('pickStories allows at most two stories per source', () => {
  const picked = pickStories(
    [
      ['Alpha harbor plan', 'Dredging begins next month along the waterfront, officials said, with several marinas affected by closures.'],
      ['Bravo school budget', 'Committee members trimmed the proposed spending plan after parents raised concerns about class sizes.'],
      ['Charlie library grant', 'A federal award will pay for new computers, longer hours and children programming through next summer.'],
    ].map(([title, summary]) => item({ title, summary, source: 'same' })),
    { now },
  );
  assert.equal(picked.length, 2);
});

test('pickMeetings keeps only meetings on the same Eastern date, in time order', () => {
  const m = (id, start) => ({ id, title: id, town: 'taunton', start, link: 'https://x.test/' + id, hasAgenda: false });
  const got = pickMeetings([m('late', '2026-10-01T22:30:00Z'), m('early', '2026-10-01T13:00:00Z'), m('tomorrow', '2026-10-02T13:00:00Z'), m('yesterday', '2026-09-30T13:00:00Z')], { now });
  assert.deepEqual(got.map((x) => x.title), ['early', 'late']);
  assert.equal(got[0].time, '9:00 AM');
});

test('buildNewsletter escapes HTML and includes alerts and a text copy', () => {
  const out = buildNewsletter({
    items: [item({ title: 'Cats <b>& dogs</b> adopt day', source: 'a' })],
    alerts: [{ event: 'Flood Warning', areas: 'Bristol, MA', link: 'https://alerts.test/1' }],
    now,
  });
  assert.ok(out.html.includes('Cats &lt;b&gt;&amp; dogs&lt;/b&gt; adopt day'));
  assert.ok(!out.html.includes('<b>& dogs'));
  assert.ok(out.html.includes('Flood Warning'));
  assert.ok(out.text.startsWith('THE BRISTOL BRIEF'));
  assert.equal(out.counts.alerts, 1);
});

test('buildNewsletter still produces a valid email on a quiet day', () => {
  const out = buildNewsletter({ items: [], now });
  assert.equal(out.counts.stories, 0);
  assert.match(out.subject, /^The Bristol Brief:/);
  assert.ok(out.html.includes('bristolbrief.com'));
});

test('shortHeadline keeps a headline whole, cuts at a clause or preposition, and returns nothing rather than half a sentence', () => {
  assert.equal(shortHeadline('Short headline stays whole', 70), 'Short headline stays whole');
  assert.equal(shortHeadline("‘Lowballed’: Churchgoers respond to the report", 80), 'Churchgoers respond to the report');
  assert.equal(shortHeadline('AG report details decades of abuse at Fall River, Springfield, Worcester dioceses', 56), 'AG report details decades of abuse');
  assert.equal(shortHeadline('General Manager of Fisher Bus responds after school bus driver throws several empty nips out the window', 48), 'General Manager of Fisher Bus responds');
  // No clean break: never cut at a comma or mid-phrase.
  assert.equal(shortHeadline('Massachusetts Teachers Association, politicians react to the new state budget proposal today', 46), '');
  assert.equal(shortHeadline('North Attleborough Town Council votes to pause automated license plate reader program', 56), '');
  // A cut never ends on a filler word.
  assert.ok(!/\s(?:of|and|the|for|to)$/i.test(shortHeadline('Public invited to meet rescue horse and her foal at Rehoboth farm today for free', 60)));
});

test('subjectFor uses the headline, or the date when it cannot be cut cleanly', () => {
  const s = (title) => ({ title });
  assert.equal(subjectFor([s('Police investigate serious I-495 crash in Mansfield')]), 'Police investigate serious I-495 crash in Mansfield');
  assert.equal(subjectFor([s('Massachusetts Teachers Association, politicians react to the new state budget proposal today and tomorrow')]), 'The Bristol Brief: ' + new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' }).replace('Sept', 'Sep'));
  assert.equal(subjectFor([], new Date('2026-10-01T10:00:00Z')), 'The Bristol Brief: Thursday, Oct 1');
  assert.ok(subjectFor([s('A very long lead headline about the harbor dredging project as the city weighs costs and funding options')]).length <= 70);
});

test('previewFor stays within 100 characters and reads as a sentence', () => {
  const st = (place) => ({ title: 'x', place });
  const stories = [st('Fall River'), st('Attleboro'), st('Somerset, Berkley'), st('Rehoboth'), st('Taunton')];
  const p = previewFor(stories, { meetings: [{}, {}], scores: [{}] });
  assert.ok(p.length <= 100, p);
  assert.match(p, /^More from .+, plus .*high school scores\.$|^More from .+, plus 2 public meetings today\.$/);
  assert.equal(previewFor(stories, { alerts: [{ event: 'Flood Warning' }] }), 'Flood Warning in effect. More from Attleboro, Somerset, Berkley and Rehoboth.');
  assert.equal(previewFor([st('Fall River')]), 'Local headlines for the 20 cities and towns of Bristol County.');
  assert.equal(previewFor([]), 'Local news for Bristol County, Massachusetts.');
});

test('pickStories keeps one copy of an incident that two outlets headline differently', () => {
  const picked = pickStories(
    [
      item({
        title: 'Attleboro police seek man accused of harassing shoppers',
        summary: 'ATTLEBORO -- City police are looking for a man accused of harassing female shoppers at Market Basket on Tuesday evening.',
        source: 'a',
        section: 'public-safety',
        towns: ['attleboro'],
      }),
      item({
        title: "Police looking for the public's help after man accused of accosting three females at Market Basket",
        summary: "Police in Bristol County are looking for the public's help to capture a suspect. According to the Attleboro Police Department, APD is seeking the identification of the male who entered the Market Basket.",
        source: 'b',
        section: 'public-safety',
        towns: ['attleboro'],
      }),
      item({
        title: 'Attleboro council debates parking rules downtown',
        summary: 'The council spent the evening on parking rules, with several residents speaking against the proposal for downtown.',
        source: 'c',
        towns: ['attleboro'],
      }),
    ],
    { now },
  );
  assert.equal(picked.filter((s) => /market basket|harassing/i.test(s.title)).length, 1);
  assert.equal(picked.length, 2);
});

test('trimSummary strips a dateline', () => {
  assert.equal(trimSummary('ATTLEBORO -- City police are looking for a man.'), 'City police are looking for a man.');
  assert.equal(trimSummary('REHOBOTH \u2014 Last month, a foal was born.'), 'Last month, a foal was born.');
  assert.equal(trimSummary('FALL RIVER \u2500 It looks like one more step remains.'), 'It looks like one more step remains.');
  assert.equal(trimSummary('BOSTON, FALL RIVER \u2013 On social media, folks ask why.'), 'On social media, folks ask why.');
  assert.equal(trimSummary('The council met Tuesday.'), 'The council met Tuesday.');
});

test('pickScores lists game results only', () => {
  const sp = (title, summary, towns) => item({ title, summary, towns, section: 'sports', source: title });
  const got = pickScores(
    [
      sp('Attleboro Area Football Hall of Fame to conduct 54th annual induction ceremony Nov. 24', 'The banquet is at the Elks lodge with several honorees from past decades named this year.', ['attleboro']),
      sp('H.S. FIELD HOCKEY: Morgan, Costa and Gilmore tally two each in King Philip win', 'The Warriors shut out Taunton High 8-0 on Thursday behind two goals each from three players.', ['taunton']),
      sp('Bombardiers edge Hornets in overtime', 'Attleboro High won on a late goal after a scoreless second half at Mansfield on Tuesday.', ['attleboro', 'mansfield']),
      sp('Sophomore eyes Westport sports history', 'A second-year student could become the first to letter in four varsity sports at the school.', ['westport']),
    ],
    { now },
  ).map((s) => s.title);
  assert.deepEqual(got, ['H.S. FIELD HOCKEY: Morgan, Costa and Gilmore tally two each in King Philip win', 'Bombardiers edge Hornets in overtime']);
  assert.equal(isScoreHeadline('H.S. GOLF: AHS nicked by Tigers'), true);
  assert.equal(isScoreHeadline('Football Hall of Fame induction ceremony'), false);
});

test('outOfState flags border-town items about Rhode Island and the like, unless the headline names the town', () => {
  const it = (title, towns) => ({ title, towns });
  assert.equal(outOfState(it('Crash causes heavy traffic in East Providence', ['seekonk'])), true);
  assert.equal(outOfState(it('Seekonk man arrested after Pawtucket chase', ['seekonk'])), false);
  assert.equal(outOfState(it('Hanover, N.H. council votes on the town budget', ['dartmouth'])), true);
  assert.equal(outOfState(it('Seekonk planners approve a new plaza', ['seekonk'])), false);
  assert.equal(outOfState(it('Tiverton fire crews help in Fall River', ['fall-river']), (s) => ({ 'fall-river': 'Fall River' })[s] ?? s), false);
});

test('pickStories skips out-of-state items', () => {
  const picked = pickStories(
    [
      item({ title: 'Crash causes heavy traffic in East Providence', towns: ['seekonk'], source: 'a', summary: 'Traffic was backed up for several hours Friday because of a crash on the East Providence-Seekonk line.' }),
      item({ title: 'Seekonk planners approve a new plaza on Route 6', towns: ['seekonk'], source: 'b' }),
    ],
    { now, townName: (s) => (s === 'seekonk' ? 'Seekonk' : s) },
  );
  assert.deepEqual(picked.map((s) => s.title), ['Seekonk planners approve a new plaza on Route 6']);
});

test('pickScores lists one line per game even when two outlets headline it differently', () => {
  const sp = (title, source, summary) => item({ title, section: 'sports', source, summary, towns: ['mansfield'] });
  const got = pickScores(
    [
      sp('Mansfield football blanks Natick, moves into conference play undefeated (video)', 'a', 'With Friday\u2019s win, the Hornets have shutout their opponent for the third time in four games.'),
      sp('H.S. FOOTBALL: Powerhouse Hornets KO Natick', 'b', 'MANSFIELD -- The Mansfield High football team cruised past Natick High on Friday, winning 28-0.'),
      sp('H.S. VOLLEYBALL: Barnstable sweeps past Attleboro', 'c', 'BARNSTABLE \u2014 The Attleboro High girls volleyball team lost 3-0.'),
    ],
    { now },
  ).map((s) => s.title);
  assert.equal(got.length, 2);
  assert.ok(got.includes('H.S. VOLLEYBALL: Barnstable sweeps past Attleboro'));
});

test('isScoreHeadline accepts game results and rejects features, matchup stubs and ceremonies', () => {
  const yes = [
    'H.S. FOOTBALL: North rules the trenches in rout',
    'H.S. GOLF: AHS nicked by Tigers',
    'Bombardiers edge Hornets in overtime',
    'Hornets blank Natick, 28-0',
    'Shamrocks fall to Concord Carlisle',
  ];
  const no = [
    '32 Greater Taunton girls volleyball players starring this fall',
    'H.S. Football: North Attleboro High vs. Canton High',
    'Attleboro Area Football Hall of Fame to conduct 54th annual induction ceremony Nov. 24',
    'Fall sports preview: who to watch',
    'Sophomore eyes Westport sports history',
  ];
  for (const t of yes) assert.equal(isScoreHeadline(t), true, t);
  for (const t of no) assert.equal(isScoreHeadline(t), false, t);
  // A matchup headline is a result when the summary carries the score.
  assert.equal(isScoreHeadline('H.S. Football: North Attleboro High vs. Canton High', 'North Attleboro won 35-14 on Friday.'), true);
});

test('pickScores skips Google News redirect links', () => {
  const sp = (title, link) => item({ title, link, section: 'sports', source: title, summary: 'The Hornets won 28-0 on Friday night in front of a full house at home.', towns: [title] });
  const got = pickScores([sp('H.S. FOOTBALL: A beats B', 'https://news.google.com/rss/articles/abc?oc=5'), sp('H.S. FOOTBALL: C beats D', 'https://example.com/c')], { now });
  assert.deepEqual(got.map((s) => s.link), ['https://example.com/c']);
});

test('with no real scores the issue has no scores section at all', () => {
  const out = buildNewsletter({
    items: [
      item({ title: 'Council votes on harbor plan after a long meeting', source: 'a' }),
      item({ title: '32 Greater Taunton girls volleyball players starring this fall', section: 'sports', source: 'b', link: 'https://example.com/v' }),
    ],
    now,
  });
  assert.equal(out.counts.scores, 0);
  assert.ok(!out.html.includes('High school scores'));
  assert.ok(!out.text.includes('HIGH SCHOOL SCORES'));
  assert.ok(!out.preheader.includes('high school scores'));
});
