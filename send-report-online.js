const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');
const https      = require('https');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_ONLINE);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const DB_URL  = 'https://online-tracker-5dd94-default-rtdb.asia-southeast1.firebasedatabase.app';
const DB_PATH = 'onlineTracker/state';

const RECIPIENTS = ['petrpesekpesek@gmail.com', 'gxt661215@icloud.com'];
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

function nowCST()      { return new Date(Date.now() + 8 * 60 * 60 * 1000); }
function toDateStr(d)  { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; }
function dayOfWeek(d)  { return d.getUTCDay(); }
function monthName(d)  { return d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }); }
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

let _token = null;
async function getToken() {
  if (!_token) {
    const r = await admin.app().options.credential.getAccessToken();
    _token = r.access_token;
  }
  return _token;
}

async function fetchPath(path) {
  const token = await getToken();
  return new Promise((resolve, reject) => {
    const url = DB_URL + '/' + path + '.json?access_token=' + encodeURIComponent(token);
    https.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('JSON parse failed: ' + body.slice(0, 300))); }
      });
    }).on('error', reject);
  });
}

async function writePath(path, value) {
  const token = await getToken();
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(value);
    const urlObj = new URL(DB_URL + '/' + path + '.json?access_token=' + encodeURIComponent(token));
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Load state ────────────────────────────────────────────────────────────────
async function loadState() {
  const data = await fetchPath(DB_PATH);
  if (!data) return { sessions: [], students: {}, staff: {} };

  const sessions = Array.isArray(data.sessions)
    ? data.sessions.filter(s => s && s.date && s.duration)
    : Object.values(data.sessions || {}).filter(s => s && s.date && s.duration);

  console.log('Sessions loaded: ' + sessions.length);
  return {
    sessions,
    students: data.students || {},
    staff:    data.staff    || {}
  };
}

// ── Calculations ──────────────────────────────────────────────────────────────
function calcSession(s, students, staff) {
  const dur      = parseFloat(s.duration) || 0;
  const student  = students[s.studentId];
  const teacher  = staff[s.teacherId];
  const asst     = staff[s.assistantId];
  const revenue  = student  ? dur * (parseFloat(student.rate)  || 0) : 0;
  const tCost    = teacher  ? dur * (parseFloat(teacher.rate)  || 0) : 0;
  const aCost    = asst     ? dur * (parseFloat(asst.rate)     || 0) : 0;
  const cost     = tCost + aCost;
  return { dur, revenue, cost, profit: revenue - cost };
}

function filterByDates(sessions, dates) {
  const set = new Set(dates);
  return sessions.filter(s => set.has(s.date));
}

function totalFinancials(sessions, students, staff) {
  let revenue = 0, cost = 0;
  for (const s of sessions) {
    const c = calcSession(s, students, staff);
    revenue += c.revenue;
    cost    += c.cost;
  }
  return { revenue, cost, profit: revenue - cost };
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtY = n => '¥' + Math.round(n).toLocaleString();

function personName(id, students, staff) {
  if (students[id]) return students[id].name;
  if (staff[id])    return staff[id].name;
  return id || '—';
}

// ── Email shell ───────────────────────────────────────────────────────────────
function emailShell(badge, badgeColor, periodLabel, totalLabel, earningsLabel, bodyHtml) {
  const statsHtml =
    '<td style="background:#f5f5f5;border-radius:6px;padding:12px 20px;">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#999;">PERIOD</div>' +
      '<div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-top:4px;">' + periodLabel + '</div></td>' +
    '<td width="12"></td>' +
    '<td style="background:#f5f5f5;border-radius:6px;padding:12px 20px;">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#999;">SESSIONS</div>' +
      '<div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-top:4px;">' + totalLabel + '</div></td>' +
    '<td width="12"></td>' +
    '<td style="background:#f5f5f5;border-radius:6px;padding:12px 20px;">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#999;">NET PROFIT</div>' +
      '<div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-top:4px;">' + earningsLabel + '</div></td>';

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">' +
  '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">' +
  '<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">' +
  '<tr><td style="background:#1a1a1a;padding:24px 28px;">' +
    '<span style="font-size:20px;font-weight:700;color:#fff;">FEK Online Tracker</span>' +
    '<span style="display:inline-block;margin-left:10px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:' + badgeColor + ';color:#fff;">' + badge + '</span>' +
  '</td></tr>' +
  '<tr><td style="padding:20px 28px 0;">' +
    '<table cellpadding="0" cellspacing="0"><tr>' + statsHtml + '</tr></table>' +
  '</td></tr>' +
  '<tr><td style="padding:20px 28px 0;"><hr style="border:none;border-top:1px solid #eee;margin:0;"></td></tr>' +
  '<tr><td style="padding:20px 28px;">' + bodyHtml + '</td></tr>' +
  '<tr><td style="padding:16px 28px;border-top:1px solid #eee;">' +
    '<div style="font-size:11px;color:#bbb;text-align:center;">Sent automatically by FEK Online Tracker via GitHub Actions</div>' +
  '</td></tr></table></td></tr></table></body></html>';
}

// ── Daily body ────────────────────────────────────────────────────────────────
function renderDailyBody(sessions, students, staff) {
  if (!sessions.length) return '<p style="color:#888;font-size:14px;">No sessions recorded.</p>';

  return sessions
    .sort((a, b) => (a.date + (a.createdAt||0)).localeCompare(b.date + (b.createdAt||0)))
    .map(s => {
      const { dur, revenue, cost, profit } = calcSession(s, students, staff);
      const student  = students[s.studentId];
      const teacher  = staff[s.teacherId];
      const asst     = staff[s.assistantId];
      const profColor = profit >= 0 ? '#1a7a4a' : '#c0392b';

      return '<div style="background:#f5f5f5;border-radius:10px;padding:14px 18px;margin-bottom:12px;">' +
        '<div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">' +
          DAY_NAMES[new Date(s.date + 'T00:00:00Z').getUTCDay()] + ' &middot; ' + s.date +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:13px;margin-bottom:10px;">' +
          '<div><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Student</span><br>' + (student ? student.name : '—') + '</div>' +
          '<div><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Teacher</span><br>' + (teacher ? teacher.name : '—') + '</div>' +
          '<div><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Assistant</span><br>' + (asst ? asst.name : '—') + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:13px;padding-top:10px;border-top:1px solid #e0e0e0;">' +
          '<div><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Duration</span><br><strong>' + dur + 'h</strong></div>' +
          '<div><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Revenue</span><br><strong>' + fmtY(revenue) + '</strong></div>' +
          '<div><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Cost</span><br><strong style="color:#c0392b;">' + fmtY(cost) + '</strong></div>' +
          '<div><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Profit</span><br><strong style="color:' + profColor + ';">' + fmtY(profit) + '</strong></div>' +
        '</div>' +
        (s.notes ? '<div style="font-size:12px;color:#666;margin-top:8px;padding-top:8px;border-top:1px solid #e0e0e0;">📝 ' + s.notes + '</div>' : '') +
      '</div>';
    }).join('');
}

// ── Weekly body ───────────────────────────────────────────────────────────────
function renderWeeklyBody(sessions, students, staff) {
  if (!sessions.length) return '<p style="color:#888;font-size:14px;">No sessions this week.</p>';

  // Group by date
  const byDate = {};
  for (const s of sessions) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  let html = '';
  for (const date of Object.keys(byDate).sort()) {
    const dow = DAY_NAMES[new Date(date + 'T00:00:00Z').getUTCDay()];
    html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:16px 0 8px;">' + dow + ' &middot; ' + date + '</div>';
    for (const s of byDate[date]) {
      const { dur, revenue, cost, profit } = calcSession(s, students, staff);
      const student = students[s.studentId];
      const teacher = staff[s.teacherId];
      const asst    = staff[s.assistantId];
      const profColor = profit >= 0 ? '#1a7a4a' : '#c0392b';
      html +=
        '<div style="background:#f5f5f5;border-radius:8px;padding:12px 16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
          '<div style="font-size:13px;">' +
            '<strong>' + (student ? student.name : '—') + '</strong>' +
            '<span style="color:#999;margin:0 6px;">with</span>' + (teacher ? teacher.name : '—') +
            (asst ? '<span style="color:#999;margin:0 6px;">+</span>' + asst.name : '') +
            '<span style="color:#999;margin-left:10px;">' + dur + 'h</span>' +
          '</div>' +
          '<div style="font-size:13px;display:flex;gap:16px;">' +
            '<span>' + fmtY(revenue) + '</span>' +
            '<span style="color:#c0392b;">' + fmtY(cost) + '</span>' +
            '<span style="font-weight:700;color:' + profColor + ';">' + fmtY(profit) + '</span>' +
          '</div>' +
        '</div>';
    }
  }

  // Totals row
  const tot = totalFinancials(sessions, students, staff);
  html +=
    '<div style="background:#1a1a1a;border-radius:8px;padding:12px 16px;margin-top:12px;display:flex;justify-content:space-between;color:#fff;font-size:13px;">' +
      '<strong>Total</strong>' +
      '<div style="display:flex;gap:20px;">' +
        '<span>' + fmtY(tot.revenue) + '</span>' +
        '<span style="color:#f5a0a0;">' + fmtY(tot.cost) + '</span>' +
        '<span style="font-weight:700;color:' + (tot.profit >= 0 ? '#6ee7a0' : '#f5a0a0') + ';">' + fmtY(tot.profit) + '</span>' +
      '</div>' +
    '</div>';

  return html;
}

// ── Monthly body ──────────────────────────────────────────────────────────────
function renderMonthlyBody(sessions, students, staff) {
  if (!sessions.length) return '<p style="color:#888;font-size:14px;">No sessions this month.</p>';

  // Totals
  const tot = totalFinancials(sessions, students, staff);

  // Section builder: name → sorted dates
  function buildSection(title, emoji, filterFn, namesFn) {
    const map = {}; // name → Set of dates
    for (const s of sessions) {
      if (!filterFn(s)) continue;
      const name = namesFn(s);
      if (!name) continue;
      if (!map[name]) map[name] = new Set();
      map[name].add(s.date);
    }
    const entries = Object.entries(map).sort((a, b) => b[1].size - a[1].size);
    if (!entries.length) return '';

    let html = '<div style="margin-bottom:24px;">' +
      '<div style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:10px;padding-bottom:4px;border-bottom:2px solid #1a1a1a;">' +
      emoji + ' ' + title + '</div>';

    for (const [name, dateSet] of entries) {
      const sortedDates = [...dateSet].sort();
      html +=
        '<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;flex-wrap:wrap;">' +
          '<span style="font-weight:600;min-width:130px;color:#1a1a1a;">' + name + '</span>' +
          '<span style="color:#888;">' + sortedDates.length + ' session' + (sortedDates.length !== 1 ? 's' : '') + '</span>' +
          '<span style="color:#555;flex:1;">' + sortedDates.map(d => {
            const dow = DAY_NAMES[new Date(d + 'T00:00:00Z').getUTCDay()].slice(0,3);
            return dow + ' ' + d.slice(5); // e.g. "Mon 04-14"
          }).join(', ') + '</span>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  const teacherSection = buildSection('Teachers', '👨‍🏫',
    s => s.teacherId && staff[s.teacherId],
    s => staff[s.teacherId] ? staff[s.teacherId].name : null
  );
  const asstSection = buildSection('Assistants', '🧑‍💼',
    s => s.assistantId && staff[s.assistantId],
    s => staff[s.assistantId] ? staff[s.assistantId].name : null
  );
  const studentSection = buildSection('Students', '🎓',
    s => s.studentId && students[s.studentId],
    s => students[s.studentId] ? students[s.studentId].name : null
  );

  // Financial summary table
  const finTable =
    '<div style="margin-bottom:24px;">' +
    '<div style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#555;margin-bottom:10px;padding-bottom:4px;border-bottom:2px solid #1a1a1a;">💰 Financials</div>' +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
      '<tr>' +
        '<td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;">Total Revenue</td>' +
        '<td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;text-align:right;">' + fmtY(tot.revenue) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;">Total Cost</td>' +
        '<td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;color:#c0392b;text-align:right;">' + fmtY(tot.cost) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td style="padding:10px 0;font-size:13px;font-weight:700;color:#1a1a1a;">Net Profit</td>' +
        '<td style="padding:10px 0;font-size:16px;font-weight:700;color:' + (tot.profit >= 0 ? '#1a7a4a' : '#c0392b') + ';text-align:right;">' + fmtY(tot.profit) + '</td>' +
      '</tr>' +
    '</table>' +
    '</div>';

  return finTable + teacherSection + asstSection + studentSection;
}

// ── Send ──────────────────────────────────────────────────────────────────────
async function sendEmail(subject, htmlBody) {
  await transporter.sendMail({
    from: '"FEK Online Tracker" <' + process.env.GMAIL_USER + '>',
    to: RECIPIENTS.join(', '),
    subject: subject,
    html: htmlBody
  });
  console.log('Sent: ' + subject);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Online report script started');
  const now       = nowCST();
  const today     = toDateStr(now);
  const yesterday = toDateStr(addDays(now, -1));
  const dow       = dayOfWeek(now);
  console.log('Today (CST): ' + today + ' | Yesterday: ' + yesterday + ' | DOW: ' + dow);

  // Duplicate-send guard
  let meta = null;
  try { meta = await fetchPath('onlineTracker/reportMeta'); } catch(e) {}
  const lastSent = meta && meta.lastDailyReport;
  if (lastSent === yesterday) {
    console.log('Already sent for ' + yesterday + ' - skipping.');
    await admin.app().delete();
    process.exit(0);
  }

  const { sessions, students, staff } = await loadState();

  // ── DAILY ──────────────────────────────────────────────────────────────────
  const dailySessions = sessions.filter(s => s.date === yesterday);
  const dailyTot      = totalFinancials(dailySessions, students, staff);
  await sendEmail(
    'FEK Online Daily Report - ' + yesterday,
    emailShell('DAILY', '#2563eb', yesterday,
      dailySessions.length + ' session' + (dailySessions.length !== 1 ? 's' : ''),
      fmtY(dailyTot.profit),
      renderDailyBody(dailySessions, students, staff))
  );
  await writePath('onlineTracker/reportMeta/lastDailyReport', yesterday);
  console.log('Marked lastDailyReport = ' + yesterday);

  // ── WEEKLY (every Monday) ──────────────────────────────────────────────────
  if (dow === 1) {
    const start = addDays(now, -7);
    const dates = Array.from({ length: 7 }, (_, i) => toDateStr(addDays(start, i)));
    const weeklySessions = sessions.filter(s => dates.includes(s.date));
    const weeklyTot      = totalFinancials(weeklySessions, students, staff);
    await sendEmail(
      'FEK Online Weekly Report - w/e ' + yesterday,
      emailShell('WEEKLY', '#16a34a',
        toDateStr(start) + ' to ' + yesterday,
        weeklySessions.length + ' session' + (weeklySessions.length !== 1 ? 's' : ''),
        fmtY(weeklyTot.profit),
        renderWeeklyBody(weeklySessions, students, staff))
    );
  }

  // ── MONTHLY (every 1st) ────────────────────────────────────────────────────
  if (now.getUTCDate() === 1) {
    const firstOfThis = new Date(today + 'T00:00:00Z');
    const lastOfPrev  = addDays(firstOfThis, -1);
    const firstOfPrev = new Date(lastOfPrev); firstOfPrev.setUTCDate(1);
    const dates = [];
    let cur = new Date(firstOfPrev);
    while (toDateStr(cur) <= toDateStr(lastOfPrev)) { dates.push(toDateStr(cur)); cur = addDays(cur, 1); }
    const monthlySessions = sessions.filter(s => dates.includes(s.date));
    const monthlyTot      = totalFinancials(monthlySessions, students, staff);
    const label           = monthName(firstOfPrev) + ' ' + firstOfPrev.getUTCFullYear();
    await sendEmail(
      'FEK Online Monthly Report - ' + label,
      emailShell('MONTHLY', '#9333ea', label,
        monthlySessions.length + ' session' + (monthlySessions.length !== 1 ? 's' : ''),
        fmtY(monthlyTot.profit),
        renderMonthlyBody(monthlySessions, students, staff))
    );
  }

  console.log('All done');
  await admin.app().delete();
  process.exit(0);
}

main().catch(async err => {
  console.error('Fatal: ' + err.message);
  try { await admin.app().delete(); } catch(_) {}
  process.exit(1);
});
