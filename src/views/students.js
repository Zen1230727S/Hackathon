/**
 * Student management list: search, filter by class, sort by attendance risk,
 * plus adding/editing students. Clicking a row opens the student detail view.
 */

import {
  getState,
  getClasses,
  getStudentsByClass,
  studentStats,
  getActiveClassId,
  addStudent,
  deleteStudent,
  updateStudent,
  getClass,
} from '../lib/store.js';
import {
  el, esc, debounce, round1, avatarDataUri, toast, openModal, closeModal, confirmDialog,
} from '../lib/utils.js';
import { cardHead, studentCell, percentCell, countPills, emptyState, classOptions } from '../lib/ui.js';

/* Filters live in module scope so they survive a re-render triggered by a
   data change (e.g. after adding a student). */
const filters = { search: '', classId: '', risk: 'all', sort: 'roll' };

export function render() {
  const state = getState();
  const classes = getClasses();
  if (!filters.classId) filters.classId = getActiveClassId() || 'all';

  /* ------------------------------- Build rows ----------------------------- */
  const rows = [];
  for (const student of state.students) {
    const stats = studentStats(student.id);
    rows.push({ student, stats });
  }

  const search = filters.search.trim().toLowerCase();
  let visible = rows.filter(({ student, stats }) => {
    if (filters.classId !== 'all' && student.classId !== filters.classId) return false;
    if (search) {
      const haystack = `${student.name} ${student.rollNo} ${student.email}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filters.risk === 'below' && !(stats.total > 0 && stats.percent < stats.plan.threshold)) return false;
    if (filters.risk === 'at-risk' && stats.risk !== 'at-risk') return false;
    if (filters.risk === 'safe' && !(stats.total > 0 && stats.percent >= stats.plan.threshold + 4)) return false;
    if (filters.risk === 'not-enrolled' && Array.isArray(student.descriptor) && student.descriptor.length) return false;
    return true;
  });

  const sorters = {
    roll: (a, b) => a.student.rollNo.localeCompare(b.student.rollNo, undefined, { numeric: true }),
    name: (a, b) => a.student.name.localeCompare(b.student.name),
    attendance: (a, b) => b.stats.percent - a.stats.percent,
    low: (a, b) => a.stats.percent - b.stats.percent,
  };
  visible = visible.sort(sorters[filters.sort] || sorters.roll);

  /* ------------------------------- Build DOM ------------------------------ */
  const root = el('div', { class: 'stack' });

  const head = el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h2', { text: 'Students' }),
      el('p', { text: `${state.students.length} students across ${classes.length} classes · fictional demo data` }),
    ]),
    el('div', { class: 'page-head-actions' }, [
      el('button', {
        class: 'btn btn-outline', type: 'button', html: '⇩ Export CSV',
        onclick: () => exportStudents(visible),
      }),
      el('button', {
        class: 'btn btn-primary', type: 'button', html: '＋ Add Student',
        onclick: () => openStudentForm(),
      }),
    ]),
  ]);
  root.append(head);

  /* -------------------------------- Toolbar ------------------------------- */
  const toolbar = el('section', { class: 'card' });
  const toolbarBody = el('div', { class: 'card-body' });
  toolbarBody.innerHTML = `
    <div class="toolbar">
      <div class="field grow" style="min-width:240px">
        <label for="studentSearch">Search</label>
        <div class="search-wrap">
          <input id="studentSearch" type="search" placeholder="Name, roll number or email…" value="${esc(filters.search)}" />
        </div>
      </div>
      <div class="field">
        <label for="classFilter">Class / Section</label>
        <select id="classFilter">
          <option value="all" ${filters.classId === 'all' ? 'selected' : ''}>All classes</option>
          ${classOptions(classes, filters.classId)}
        </select>
      </div>
      <div class="field">
        <label for="riskFilter">Attendance</label>
        <select id="riskFilter">
          <option value="all" ${filters.risk === 'all' ? 'selected' : ''}>All students</option>
          <option value="below" ${filters.risk === 'below' ? 'selected' : ''}>Below threshold</option>
          <option value="at-risk" ${filters.risk === 'at-risk' ? 'selected' : ''}>At risk (within 4%)</option>
          <option value="safe" ${filters.risk === 'safe' ? 'selected' : ''}>Comfortably safe</option>
          <option value="not-enrolled" ${filters.risk === 'not-enrolled' ? 'selected' : ''}>Face not enrolled</option>
        </select>
      </div>
      <div class="field">
        <label for="sortBy">Sort by</label>
        <select id="sortBy">
          <option value="roll" ${filters.sort === 'roll' ? 'selected' : ''}>Roll number</option>
          <option value="name" ${filters.sort === 'name' ? 'selected' : ''}>Name (A–Z)</option>
          <option value="attendance" ${filters.sort === 'attendance' ? 'selected' : ''}>Attendance (high → low)</option>
          <option value="low" ${filters.sort === 'low' ? 'selected' : ''}>Attendance (low → high)</option>
        </select>
      </div>
    </div>`;
  toolbar.append(toolbarBody);
  root.append(toolbar);

  /* --------------------------------- Table -------------------------------- */
  const tableCard = el('section', { class: 'card' });
  tableCard.innerHTML = cardHead('Student Roster', `${visible.length} of ${state.students.length} students shown`);

  if (!visible.length) {
    const empty = el('div');
    empty.innerHTML = emptyState('No students match your filters', 'Try clearing the search box or choosing “All classes”.', '🔍');
    tableCard.append(empty);
  } else {
    const wrap = el('div', { class: 'table-wrap' });
    wrap.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Student</th>
            <th>Class</th>
            <th>Attendance</th>
            <th>Present / Late / Absent</th>
            <th>Face</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${visible.map(({ student, stats }) => `
            <tr data-student="${esc(student.id)}" style="cursor:pointer">
              <td>${studentCell(student)}</td>
              <td class="nowrap">${esc(getClass(student.classId)?.name || '—')}</td>
              <td>${percentCell(stats.percent, stats.plan.threshold, stats.total)}</td>
              <td class="nowrap">${countPills(stats)}</td>
              <td>${Array.isArray(student.descriptor) && student.descriptor.length
                ? '<span class="badge badge-violet">Enrolled</span>'
                : '<span class="badge">Not set</span>'}</td>
              <td class="num nowrap">
                <button class="btn btn-sm btn-outline" type="button" data-open="${esc(student.id)}">View</button>
                <button class="btn btn-sm btn-ghost" type="button" data-edit="${esc(student.id)}" title="Edit">✎</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    tableCard.append(wrap);
  }
  root.append(tableCard);

  /* ------------------------------- Events --------------------------------- */
  const searchInput = toolbarBody.querySelector('#studentSearch');
  searchInput?.addEventListener('input', debounce((event) => {
    filters.search = event.target.value;
    rerender();
  }, 200));

  toolbarBody.querySelector('#classFilter')?.addEventListener('change', (event) => {
    filters.classId = event.target.value;
    rerender();
  });
  toolbarBody.querySelector('#riskFilter')?.addEventListener('change', (event) => {
    filters.risk = event.target.value;
    rerender();
  });
  toolbarBody.querySelector('#sortBy')?.addEventListener('change', (event) => {
    filters.sort = event.target.value;
    rerender();
  });

  tableCard.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit]');
    if (editBtn) {
      event.stopPropagation();
      openStudentForm(editBtn.dataset.edit);
      return;
    }
    const openBtn = event.target.closest('[data-open]');
    if (openBtn) {
      window.location.hash = `#/students/${openBtn.dataset.open}`;
      return;
    }
    const row = event.target.closest('[data-student]');
    if (row) window.location.hash = `#/students/${row.dataset.student}`;
  });

  return { title: 'Students', subtitle: 'Search, filter and manage student records', element: root };
}

function rerender() {
  // Ask the app shell to re-render the current route (simplest consistent way
  // to refresh while keeping the module-level filter state).
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/* ------------------------------ Modal forms ------------------------------- */

export function openStudentForm(studentId = null) {
  const classes = getClasses();
  const student = studentId ? getState().students.find((s) => s.id === studentId) : null;
  const activeClass = getActiveClassId();

  const form = el('form', { class: 'stack' });
  form.innerHTML = `
    <div class="grid grid-2">
      <div class="field">
        <label for="f-name">Full name *</label>
        <input id="f-name" type="text" required value="${esc(student?.name || '')}" placeholder="e.g. Aarav Sharma" />
      </div>
      <div class="field">
        <label for="f-roll">Roll number *</label>
        <input id="f-roll" type="text" required value="${esc(student?.rollNo || '')}" placeholder="e.g. CS23A-013" />
      </div>
      <div class="field">
        <label for="f-class">Class / Section *</label>
        <select id="f-class" required>
          ${classOptions(classes, student?.classId || activeClass)}
        </select>
      </div>
      <div class="field">
        <label for="f-email">Email (optional)</label>
        <input id="f-email" type="email" value="${esc(student?.email || '')}" placeholder="student@demo.college" />
      </div>
    </div>`;

  const preview = el('div', { class: 'row' }, [
    el('img', { src: student?.photo || avatarDataUri(student?.name || 'New Student'), alt: '', class: 'avatar', style: 'width:56px;height:56px;border-radius:14px;object-fit:cover;' }),
    el('span', { class: 'small muted', text: student ? 'Reference face is managed on the Face Enrollment page.' : 'A placeholder avatar is generated automatically. Enroll a face from the Face Enrollment page.' }),
  ]);

  const actions = el('div', { class: 'row', style: 'justify-content:flex-end;gap:10px' }, [
    student ? el('button', {
      class: 'btn btn-danger', type: 'button', text: 'Delete student',
      onclick: async () => {
        const yes = await confirmDialog({
          title: 'Delete student',
          message: `Delete ${student.name} and all their attendance records? This cannot be undone (use Demo Reset to restore the demo data).`,
          confirmLabel: 'Delete', tone: 'danger',
        });
        if (!yes) return;
        deleteStudent(student.id);
        closeModal();
        toast('Student deleted', `${student.name} was removed.`, 'warn');
        window.location.hash = '#/students';
      },
    }) : null,
    el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: closeModal }),
    el('button', { class: 'btn btn-primary', type: 'submit', text: student ? 'Save changes' : 'Add student' }),
  ]);

  form.append(preview, actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = form.querySelector('#f-name').value.trim();
    const rollNo = form.querySelector('#f-roll').value.trim();
    const classId = form.querySelector('#f-class').value;
    const email = form.querySelector('#f-email').value.trim();
    if (!name || !rollNo) {
      toast('Missing details', 'Name and roll number are required.', 'warn');
      return;
    }
    if (student) {
      updateStudent(student.id, { name, rollNo, classId, email });
      toast('Student updated', name, 'ok');
    } else {
      const result = addStudent({ name, rollNo, classId, email, photo: avatarDataUri(name) });
      if (!result.ok) {
        toast('Could not add student', result.reason || 'Unknown error', 'danger');
        return;
      }
      toast('Student added', `${name} was added to the roster.`, 'ok');
    }
    closeModal();
    rerender();
  });

  openModal(student ? `Edit ${student.name}` : 'Add student', form);
}

/* --------------------------------- Export -------------------------------- */

function exportStudents(rows) {
  import('../lib/utils.js').then(({ toCSV, downloadFile, todayISO }) => {
    const headers = ['Roll No', 'Name', 'Class', 'Email', 'Sessions Held', 'Present', 'Late', 'Absent', 'Attendance %', 'Status'];
    const data = rows.map(({ student, stats }) => [
      student.rollNo,
      student.name,
      getClass(student.classId)?.name || '',
      student.email,
      stats.total,
      stats.present,
      stats.late,
      stats.absent,
      round1(stats.percent),
      stats.total ? (stats.percent < stats.plan.threshold ? 'Below threshold' : 'OK') : 'No data',
    ]);
    downloadFile(`students-${todayISO()}.csv`, toCSV(headers, data));
    toast('Export complete', `${data.length} rows exported to CSV.`, 'ok');
  });
}