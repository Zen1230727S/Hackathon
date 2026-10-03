/**
 * Central role-based login (demo).
 *
 * Teacher / Admin  -> existing #/dashboard
 * Student          -> new #/student portal (read-only)
 *
 * This page is shown as the app entry point. It performs NO redirects for other
 * routes - the router still renders every existing route exactly as before; this
 * view only decides where to send the user after a successful sign-in.
 */

import { el, esc, avatarDataUri } from '../lib/utils.js';
import { cardHead } from '../lib/ui.js';
import { getStudents, getClass } from '../lib/store.js';
import {
  DEMO_TEACHER, DEMO_STUDENT_PASSWORD,
  setTeacherSession, setStudentSession,
} from '../lib/session.js';

export function render() {
  const students = getStudents()
    .slice()
    .sort((a, b) => a.rollNo.localeCompare(b.rollNo, undefined, { numeric: true }));

  const root = el('div', { class: 'login-page' });
  const grid = el('div', { class: 'login-grid' });

  /* ------------------------------ Teacher card ---------------------------- */
  const teacherCard = el('section', { class: 'card' });
  teacherCard.innerHTML = cardHead('Teacher / Admin', 'Manage attendance, students and reports');

  const teacherBody = el('div', { class: 'card-body stack' });
  teacherBody.append(el('div', { html:
    `<div class="callout"><span class="co-ico">🔐</span><div>
      Demo credentials — ID <span class="mono">${esc(DEMO_TEACHER.id)}</span> /
      password <span class="mono">${esc(DEMO_TEACHER.password)}</span>.
      Prototype sign-in only, not production security.
    </div></div>` }));

  const teacherError = el('p', { class: 'login-error', hidden: true });
  const teacherInput = el('input', { id: 'li-teacher-id', type: 'text', placeholder: DEMO_TEACHER.id, autocomplete: 'off' });
  const teacherPass = el('input', { id: 'li-teacher-pass', type: 'password', placeholder: DEMO_TEACHER.password, autocomplete: 'off' });

  const idField = el('div', { class: 'field' });
  idField.append(el('label', { for: 'li-teacher-id', text: 'Teacher ID' }), teacherInput);
  const passField = el('div', { class: 'field' });
  passField.append(el('label', { for: 'li-teacher-pass', text: 'Password' }), teacherPass);

  const teacherBtn = el('button', {
    class: 'btn btn-primary btn-lg btn-block', type: 'button', text: 'Sign in as Teacher / Admin',
  });

  const submitTeacher = () => {
    const id = teacherInput.value.trim();
    const pass = teacherPass.value.trim();
    if (id.toLowerCase() === DEMO_TEACHER.id && pass === DEMO_TEACHER.password) {
      setTeacherSession(DEMO_TEACHER.id);
      window.location.hash = '#/dashboard';
    } else {
      teacherError.hidden = false;
      teacherError.textContent = 'Incorrect demo credentials. Use the values shown above.';
    }
  };
  teacherBtn.addEventListener('click', submitTeacher);
  [teacherInput, teacherPass].forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitTeacher(); }
  }));

  teacherBody.append(idField, passField, teacherError, teacherBtn);
  teacherCard.append(teacherBody);

  /* ------------------------------ Student card ---------------------------- */
  const studentCard = el('section', { class: 'card' });
  studentCard.innerHTML = cardHead('Student', 'View your own attendance (read-only)');

  const studentBody = el('div', { class: 'card-body stack' });
  studentBody.append(el('div', { html:
    `<div class="callout"><span class="co-ico">🎒</span><div>
      Sign in with your <strong>roll number</strong> and the shared demo password
      <span class="mono">${esc(DEMO_STUDENT_PASSWORD)}</span>.
    </div></div>` }));

  const studentError = el('p', { class: 'login-error', hidden: true });

  const rollSelect = el('select', { id: 'li-student-roll' });
  if (students.length) {
    rollSelect.innerHTML = '<option value="">— select your roll number —</option>' + students.map((s) => {
      const cls = getClass(s.classId);
      return `<option value="${esc(s.rollNo)}">${esc(s.rollNo)} · ${esc(s.name)}${cls ? ` · ${esc(cls.name)}` : ''}</option>`;
    }).join('');
  } else {
    rollSelect.innerHTML = '<option value="">No students available</option>';
    rollSelect.disabled = true;
  }

  const rollField = el('div', { class: 'field' });
  rollField.append(el('label', { for: 'li-student-roll', text: 'Roll number (student ID)' }), rollSelect);

  const studentPass = el('input', { id: 'li-student-pass', type: 'password', placeholder: DEMO_STUDENT_PASSWORD, autocomplete: 'off' });
  const studentPassField = el('div', { class: 'field' });
  studentPassField.append(el('label', { for: 'li-student-pass', text: 'Password' }), studentPass);

  const studentBtn = el('button', {
    class: 'btn btn-outline btn-lg btn-block', type: 'button', text: 'Sign in as Student',
  });

  const submitStudent = () => {
    const roll = rollSelect.value.trim().toLowerCase();
    const pass = studentPass.value.trim();
    if (pass !== DEMO_STUDENT_PASSWORD) {
      studentError.hidden = false;
      studentError.textContent = `Incorrect demo password. Use "${DEMO_STUDENT_PASSWORD}".`;
      return;
    }
    const match = students.find((s) => s.rollNo.toLowerCase() === roll || s.id.toLowerCase() === roll);
    if (!match) {
      studentError.hidden = false;
      studentError.textContent = 'Select your roll number from the list to continue.';
      return;
    }
    setStudentSession(match.id); // store ONLY the student id
    window.location.hash = '#/student';
  };
  studentBtn.addEventListener('click', submitStudent);
  [rollSelect, studentPass].forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitStudent(); }
  }));

  studentBody.append(rollField, studentPassField, studentError, studentBtn);

  if (students.length) {
    const sample = students[0];
    studentBody.append(el('p', {
      class: 'small muted',
      text: `Tip: any student works, e.g. ${sample.rollNo} (${sample.name}).`,
    }));
  }

  studentCard.append(studentBody);

  grid.append(teacherCard, studentCard);
  root.append(grid);

  return {
    title: 'Sign in',
    subtitle: 'Smart Attendance Management System · demo prototype',
    element: root,
  };
}