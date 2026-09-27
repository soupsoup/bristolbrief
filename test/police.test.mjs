import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNbArrestLog, parseTauntonLog, streetOnly, cleanOffense, mergePolice } from '../scripts/lib/police.mjs';

// tesseract output from a scanned New Bedford log (names are made up).
const NB_OCR = `ieemeee NEW BEDFORD Page: 1
From: 09/20/2026 Thru: 09/20/2026
Case Number Arr.ID Ast.ID Det.ID Reported Status AgabD
26-1589-AR 4165 2026-09-19 Open Y NN
Arrest Date> 2026-09-20 00:41
Location> Zone: 31 Grid 25A
202 BELLEVILLE AVE
Offenses> (1) OUI-LIQUOR OR .08%
IBR: 90D - DRIVING UNDER THE INFLUENCE
(2) NEGLIGENT OPERATION OF MOTOR VEHICLE
IBR: 99 - TRAFFIC, TOWN BY-LAW OFFENSES
Suspects> (1) JOHN DOE
331 BELLEVILLE AVE
NEW BEDFORD MA
Case Number Arr.ID Ast.ID Det.ID Reported Status A JD
26-1590-AR 29611 4065 2026-09-20 Open Y N Y
Arrest Date> 2026-09-20 03:30
Location> Zone: 31 Grid 24
73 BULLARD ST
Offenses> (1) WARRANT ARREST DOKT#2633CR002832
IBR: 90Z - ALL OTHER OFFENSES
Suspects> (1) JANE ROE
26-1591-AR 29611 2026-09-20 Open Y Y N
Arrest Date> 2026-09-20 04:00
Location> Zone: 1 Grid 2
10 MAIN ST
Offenses> (1) LARCENY
Suspects> (1) KID
26-1592-AR 29611 2026-09-20 Open Y ¥ N
Arrest Date> 2026-09-20 05:00
Location> Zone: 1 Grid 2
12 MAIN ST
Offenses> (1) LARCENY
Report generated at: 09/21/2026, 07:40:02`;

test('New Bedford arrest log: no names or house numbers, no juveniles', () => {
  const out = parseNbArrestLog(NB_OCR, { pdf: 'https://x/log.pdf' });
  assert.deepEqual(out.map((e) => e.id), ['nbpd-26-1589-AR', 'nbpd-26-1590-AR']);
  assert.equal(out[0].date, '2026-09-20T00:41');
  assert.equal(out[0].street, 'Belleville Ave');
  assert.deepEqual(out[0].offenses, ['OUI-Liquor or .08%', 'Negligent operation of motor vehicle']);
  assert.equal(out[1].domestic, true);
  assert.deepEqual(out[1].offenses, ['Warrant arrest']);
  assert.ok(!JSON.stringify(out).match(/DOE|ROE|331/));
});

const TPD = `Police - Public Log                                                                 Printed On: 07/06/26 14:32
RMS Incident # Reported                 Location           Incident Type            Action Taken
26-000001            01/01/2026 12:32   Somerset Ave       Disturbance              Advised
Responding Officers
Medeiros, Justin L

26-000002            01/01/2026 12:42   Broadway           Building Check           Services Rendered
26-000005            01/01/2026 01:01   Weir St            Assist Other Agency      Arrest(S) Made
                                                           (City, State, Federal,
                                                           Police, Fire)
26-000006            01/01/2026 03:08   School St          Medical                  Transported To Hospital
26-000007            01/01/2026 01:15   Barnum St          Past B & E               Report Due
 26-000008            01/03/26 16:23     Roe, Jane   999 Summer St, Taunton, MA        59       W      M`;

test('Taunton log: notable calls only, PM inferred from order', () => {
  const out = parseTauntonLog(TPD);
  assert.deepEqual(out.map((e) => e.id), ['tpd-26-000001', 'tpd-26-000005', 'tpd-26-000007']);
  assert.equal(out[0].date, '2026-01-01T00:32');
  assert.equal(out[1].type, 'Assist Other Agency (City, State, Federal, Police, Fire)');
  assert.equal(out[2].date, '2026-01-01T13:15');
  assert.ok(!JSON.stringify(out).match(/Medeiros|Roe/));
});

test('street and offense cleanup', () => {
  assert.equal(streetOnly('640 PLEASANT ST'), 'Pleasant St');
  assert.equal(streetOnly('1234-B ACUSHNET AVE #2'), 'Acushnet Ave');
  assert.equal(cleanOffense('WARRANT ARREST DKT # 2633CR003219'), 'Warrant arrest');
});

test('police entries are kept six months', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  const out = mergePolice([{ id: 'old', date: '2026-03-01T10:00' }], [{ id: 'new', date: '2026-09-20T10:00' }], now);
  assert.deepEqual(out.map((e) => e.id), ['new']);
});
