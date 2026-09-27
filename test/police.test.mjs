import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNbArrestLog, parseTauntonLog, parseAttleboroLog, streetOnly, cleanOffense, mergePolice } from '../scripts/lib/police.mjs';

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

// pdftotext -layout output from an Attleboro weekly log (names are made up).
const APD = `                             Attleboro Police Department
                                          Public Police Log
Incident #      Date     Time                   Address                   Incident Type        Action Taken
2600067869     8/9/2026     11:46 PM          ONEIL BLVD                SECURITY CHECK          SERVICE
                                                                                               RENDERED
2600067867     8/9/2026     11:21 PM         SECOND ST                   DISTURBANCE            PEACE
                                                                                               RESTORED
2600067858     8/9/2026     9:44 PM          HUDSON ST                      MEDICAL             SERVICE
                                                                                               RENDERED
2600067737     8/9/2026     11:32 AM        NEWPORT AVE                WARRANT SERVICE         ADULT FEMALE
                                                                                             ARRESTED
2600067700     8/9/2026     10:00 AM        PARK ST                    LARCENY                 JUVENILE MALE
                                                                                             ARRESTED
2600067690     8/9/2026     9:00 AM         SLATER ST                  ASSAULT                 ADULT MALE
                                                                                             ARRESTED
2500207800     12/21/202 11:50 PM             KEVIN DR                   DISTURBANCE            NO REPORT
               5
             Page 1 of 2                     Report Run Date an Time: 8/17/2026 10:54:42 AM
Arrests:
Incident #       Arrest Date /Time     Name                   Address                        Age Race Gender
2600067737      08/09/2026   11:32 AM Doe,Jane           97 Wendell St Pawtucket, RI    40 B F
                                                            02861
Charges
90/34J UNINSURED MOTOR VEHICLE c90 §34J

3601 WARRANT ARREST

2600067690      08/09/2026   9:00 AM Roe,Rick           1 Main St Attleboro, MA    16 W M
Charges
265/13A/A ASSAULT c265 §13A
`;

test('Attleboro log: notable calls, charges without names, no juveniles', () => {
  const out = parseAttleboroLog(APD);
  assert.deepEqual(out.map((e) => e.id), ['apd-2600067867', 'apd-2600067737', 'apd-2500207800']);
  assert.equal(out[0].date, '2026-08-09T23:21');
  assert.equal(out[0].action, 'Peace Restored');
  assert.equal(out[1].action, 'Arrest');
  assert.deepEqual(out[1].charges, ['Uninsured motor vehicle', 'Warrant arrest']);
  assert.equal(out[2].date, '2025-12-21T23:50');
  assert.ok(!JSON.stringify(out).match(/Doe|Roe|Wendell|Pawtucket|Slater/));
});
